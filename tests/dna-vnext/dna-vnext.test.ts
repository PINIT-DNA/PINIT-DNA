import sharp from 'sharp';
import { generateBlockDnaTags, packTags } from '../../src/services/block-dna/manifest';
import { blockDnaConfig } from '../../src/config/block-dna';
import { buildHierarchyFromBlockDna } from '../../src/services/dna-vnext/hierarchy';
import { signWatermarkBody, verifyWatermarkMac, watermarkLookupId } from '../../src/services/dna-vnext/crypto';
import {
  embedRobustProvenanceWatermark,
  extractWatermarkLookupId,
} from '../../src/services/dna-vnext/robust-watermark';
import { PIXEL_EVIDENCE_POLICY } from '../../src/types/dna-vnext.types';
import { buildDnaVnextInvestigationSection } from '../../src/services/dna-vnext/investigation';

function solidRgb(width: number, height: number, r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
  return buf;
}

describe('DNA vNext provenance layer', () => {
  it('does not claim an independent Vault ID per RGB pixel', () => {
    expect(PIXEL_EVIDENCE_POLICY.independentPixelContainsVaultId).toBe(false);
    expect(PIXEL_EVIDENCE_POLICY.watermarkDoesNotColorPixels).toBe(true);
    expect(PIXEL_EVIDENCE_POLICY.authenticationUnit).toBe('patch_8x8');
    expect(PIXEL_EVIDENCE_POLICY.evidenceRadiusPx).toBe(16);
    expect(PIXEL_EVIDENCE_POLICY.minAuthenticableAreaPx).toBe(256);
    const section = buildDnaVnextInvestigationSection({
      provenance: null,
      watermark: {
        recovered: true,
        mechanism: 'DNA_B_ROBUST_PROVENANCE',
        watermarkVersion: 'robust-dwt-v1',
        spatialConfidencePercent: 90,
        doesNotImplyPixelCoverage: true,
      },
      spatialMatch: true,
      hmacAvailable: true,
      transformations: ['crop_or_partial_frame'],
    });
    expect(section.note).toMatch(/not because it stores a Vault ID/i);
    expect(section.mechanisms.dnaB.recovery?.doesNotImplyPixelCoverage).toBe(true);
  });

  it('builds a hierarchical commit over 8×8 HMAC cells', () => {
    const width = 32;
    const height = 32;
    const rgb = solidRgb(width, height, 40, 80, 120);
    const { tags, blockSize } = generateBlockDnaTags({
      rgb,
      width,
      height,
      imageId: 'dna-test-image',
    });
    const packed = packTags(tags);
    const hier = buildHierarchyFromBlockDna({
      imageId: 'dna-test-image',
      width,
      height,
      blockSize,
      algorithm: 'HMAC-SHA256',
      version: 1,
      tagBytes: tags[0]!.length,
      tagsB64: packed.toString('base64'),
    });
    expect(hier.regions).toHaveLength(4);
    expect(hier.rootAuthenticationHex16).toHaveLength(16);
    expect(hier.regions.reduce((n, r) => n + r.cellCount, 0)).toBe(
      Math.ceil(width / blockDnaConfig.blockSize) * Math.ceil(height / blockDnaConfig.blockSize),
    );
  });

  it('authenticates a compact watermark payload (MAC rejects edits)', () => {
    const body = Buffer.from('PIT1\x01abcdefgh\x00', 'binary');
    const mac = signWatermarkBody(body);
    expect(verifyWatermarkMac(body, mac)).toBe(true);
    const tampered = Buffer.from(body);
    tampered[5] = tampered[5]! ^ 0xff;
    expect(verifyWatermarkMac(tampered, mac)).toBe(false);
  });

  it('round-trips DNA-B lookup id through a PNG without embedding a raw Vault UUID', async () => {
    const vaultId = '11111111-1111-4111-8111-111111111111';
    const dnaRecordId = '22222222-2222-4222-8222-222222222222';
    // 640x640 -> 1,600 16x16 tiles, enough for 2 full copies of the 720-bit
    // (30-byte x8 x3-redundancy) payload at the current 1-bit-per-tile
    // capacity. A real photo is virtually always this size or larger; 256x256
    // (400 tiles) was sized for an earlier 4-bits/tile scheme and is too
    // small for the current half-tile Patchwork embedder — see
    // src/services/dna-vnext/robust-watermark.ts's header comment.
    const png = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 18, g: 64, b: 90 } },
    }).png().toBuffer();
    const embedded = await embedRobustProvenanceWatermark({
      buffer: png,
      mimeType: 'image/png',
      vaultId,
      dnaRecordId,
    });
    expect(embedded.embedded).toBe(true);
    const lookup = await extractWatermarkLookupId(embedded.buffer);
    expect(lookup).toBe(watermarkLookupId(vaultId, dnaRecordId));
    expect(embedded.buffer.includes(Buffer.from(vaultId))).toBe(false);
  });
});
