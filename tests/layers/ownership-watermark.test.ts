/**
 * Ownership watermark — spatial-block tiling + crop survival (~20%).
 */

import sharp from 'sharp';
import {
  embedOwnershipWatermark,
  extractOwnershipWatermark,
  ownershipPayloadHmac,
  OWNERSHIP_BLOCK_W,
  OWNERSHIP_BLOCK_H,
} from '../../src/services/layers/ownership-watermark';

async function makeRgb(w: number, h: number): Promise<{ rgb: Buffer; width: number; height: number }> {
  const { data, info } = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 90, g: 140, b: 200 } },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgb: data, width: info.width, height: info.height };
}

describe('ownership-watermark', () => {
  const meta = {
    dnaRecordId: 'dna-record-uuid-001',
    ownerUserId: 'user-uuid-owner-001',
    vaultId: 'vault-or-dna-001',
    filename: 'contract.png',
    mimeType: 'image/png',
    uploadedAt: new Date('2026-07-27T10:00:00.000Z'),
    ip: '1.2.3.4',
    country: 'IN',
    city: 'Hyderabad',
    userAgent: 'jest',
  };

  it('embeds tiles across spatial blocks and recovers from full image', async () => {
    const { rgb, width, height } = await makeRgb(128, 128);
    const { rgb: carrier, signature } = embedOwnershipWatermark(rgb, width, height, meta);

    expect(signature.tileCount).toBeGreaterThan(1);
    expect(signature.blockWidth).toBe(OWNERSHIP_BLOCK_W);
    expect(signature.blockHeight).toBe(OWNERSHIP_BLOCK_H);
    expect(signature.dnaRecordId).toBe(meta.dnaRecordId);
    expect(signature.ownerUserId).toBe(meta.ownerUserId);
    expect(signature.filename).toBe('contract.png');

    const extracted = extractOwnershipWatermark(carrier, width, height);
    expect(extracted.found).toBe(true);
    expect(extracted.sealValid).toBe(true);
    expect(extracted.dnaFingerprint).toBe(signature.dnaFingerprint);
    expect(ownershipPayloadHmac(extracted.tileHex!)).toBe(ownershipPayloadHmac(signature.tileHex));
  });

  it('recovers identity from ~20% crop (center fragment)', async () => {
    const w = 200;
    const h = 200;
    const { rgb } = await makeRgb(w, h);
    const { rgb: carrier, signature } = embedOwnershipWatermark(rgb, w, h, meta);

    // Center crop ≈ 20% of pixels (90×90 ≈ 20.25%) — must contain ≥1 full 32×16 block
    const cropW = 90;
    const cropH = 90;
    const x0 = Math.floor((w - cropW) / 2);
    const y0 = Math.floor((h - cropH) / 2);
    const fragment = Buffer.alloc(cropW * cropH * 3);
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        const src = ((y0 + y) * w + (x0 + x)) * 3;
        const dst = (y * cropW + x) * 3;
        fragment[dst] = carrier[src]!;
        fragment[dst + 1] = carrier[src + 1]!;
        fragment[dst + 2] = carrier[src + 2]!;
      }
    }

    expect(cropW).toBeGreaterThanOrEqual(OWNERSHIP_BLOCK_W);
    expect(cropH).toBeGreaterThanOrEqual(OWNERSHIP_BLOCK_H);

    const extracted = extractOwnershipWatermark(fragment, cropW, cropH);
    expect(extracted.found).toBe(true);
    expect(extracted.sealValid).toBe(true);
    expect(extracted.dnaFingerprint).toBe(signature.dnaFingerprint);
    expect(extracted.ownerFingerprint).toBe(signature.ownerFingerprint);
  });

  it('stores enough detail for vault/user/upload attribution', async () => {
    const { rgb, width, height } = await makeRgb(64, 64);
    const { signature } = embedOwnershipWatermark(rgb, width, height, meta);
    expect(signature.vaultId).toBe(meta.vaultId);
    expect(signature.ip).toBe('1.2.3.4');
    expect(signature.country).toBe('IN');
    expect(signature.city).toBe('Hyderabad');
    expect(signature.tileHex).toHaveLength(128);
    expect(signature.cropSurvivalTarget).toBe('20%+');
  });
});
