import sharp from 'sharp';
import {
  compareAlignedBlocks,
  identityAlignment,
  offsetAlignment,
  vaultTagsFromRgb,
} from '../../src/services/block-dna/compare';
import { investigateBlockDna } from '../../src/services/block-dna/investigate';
import { computeBlockDnaHmac } from '../../src/services/block-dna/hmac';
import { BLOCK_DNA_VERSION } from '../../src/config/block-dna';

const BLOCK = 8;
const ID = 'vault-image-test-1';

function fillRgb(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): Buffer {
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return rgb;
}

function uniquePattern(w: number, h: number): Buffer {
  return fillRgb(w, h, (x, y) => [x % 256, y % 256, (x * 7 + y * 13) % 256]);
}

function clone(buf: Buffer): Buffer {
  return Buffer.from(buf);
}

function setPixel(rgb: Buffer, w: number, x: number, y: number, rgbv: [number, number, number]) {
  const i = (y * w + x) * 3;
  rgb[i] = rgbv[0];
  rgb[i + 1] = rgbv[1];
  rgb[i + 2] = rgbv[2];
}

function copyBlock(
  src: Buffer, srcW: number,
  dst: Buffer, dstW: number,
  sx: number, sy: number, dx: number, dy: number, bw: number, bh: number,
) {
  for (let row = 0; row < bh; row++) {
    const s = ((sy + row) * srcW + sx) * 3;
    const d = ((dy + row) * dstW + dx) * 3;
    src.copy(dst, d, s, s + bw * 3);
  }
}

function runCompare(probe: Buffer, vault: Buffer, w: number, h: number, imageId = ID) {
  const tags = vaultTagsFromRgb({ rgb: vault, width: w, height: h, imageId, blockSize: BLOCK });
  return compareAlignedBlocks({
    probeRgb: probe,
    probeW: w,
    probeH: h,
    vaultRgb: vault,
    vaultW: w,
    vaultH: h,
    imageId,
    vaultTags: tags,
    blockSize: BLOCK,
    alignment: identityAlignment(),
  });
}

describe('block-level HMAC DNA', () => {
  const W = 32;
  const H = 32;

  it('TEST 1 — original vs vault: every block ORIGINAL', () => {
    const vault = uniquePattern(W, H);
    const { cells, labels } = runCompare(vault, vault, W, H);
    expect(cells).toHaveLength(16);
    expect(new Set(cells.map((c) => c.vaultDna)).size).toBeGreaterThan(1);
    expect(labels).toBe('G'.repeat(16));
    expect(cells.every((c) => c.status === 'ORIGINAL' && c.dnaVerified)).toBe(true);
  });

  it('enrolls an independent DNA per block (not one global hash)', () => {
    const vault = uniquePattern(W, H);
    const tags = vaultTagsFromRgb({ rgb: vault, width: W, height: H, imageId: ID, blockSize: BLOCK });
    const unique = new Set(tags.map((t) => t.toString('hex')));
    expect(unique.size).toBe(tags.length);
  });

  it('TEST 2 — single pixel change marks only that block MODIFIED', () => {
    const vault = uniquePattern(W, H);
    const probe = clone(vault);
    const i = (10 * W + 10) * 3;
    setPixel(probe, W, 10, 10, [vault[i]!, vault[i + 1]!, (vault[i + 2]! + 1) % 256]);
    const { cells } = runCompare(probe, vault, W, H);
    const hit = cells.filter((c) => c.status === 'MODIFIED');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.x).toBe(8);
    expect(hit[0]!.y).toBe(8);
    expect(cells.filter((c) => c.status === 'ORIGINAL')).toHaveLength(15);
  });

  it('TEST 3 — several pixels in one block', () => {
    const vault = uniquePattern(W, H);
    const probe = clone(vault);
    for (let i = 0; i < 5; i++) setPixel(probe, W, 8 + i, 8, [255, 0, 0]);
    const { cells } = runCompare(probe, vault, W, H);
    expect(cells.filter((c) => c.status === 'MODIFIED')).toHaveLength(1);
    expect(cells.find((c) => c.x === 8 && c.y === 8)?.status).toBe('MODIFIED');
  });

  it('TEST 4 — entire 8×8 block replaced', () => {
    const vault = uniquePattern(W, H);
    const probe = clone(vault);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) setPixel(probe, W, x, y, [1, 2, 3]);
    }
    const { cells } = runCompare(probe, vault, W, H);
    expect(cells.find((c) => c.x === 0 && c.y === 0)?.status).toBe('MODIFIED');
    expect(cells.filter((c) => c.status === 'ORIGINAL')).toHaveLength(15);
  });

  it('TEST 5 — separated blocks', () => {
    const vault = uniquePattern(W, H);
    const probe = clone(vault);
    setPixel(probe, W, 0, 0, [9, 9, 9]);
    setPixel(probe, W, 24, 24, [9, 9, 9]);
    const { cells } = runCompare(probe, vault, W, H);
    const mod = cells.filter((c) => c.status === 'MODIFIED');
    expect(mod).toHaveLength(2);
    expect(mod.map((c) => `${c.x},${c.y}`).sort()).toEqual(['0,0', '24,24']);
  });

  it('TEST 6 — painted object (AI-like region) is MODIFIED only there', () => {
    const vault = uniquePattern(W, H);
    const probe = clone(vault);
    for (let y = 16; y < 24; y++) {
      for (let x = 16; x < 24; x++) setPixel(probe, W, x, y, [200, 10, 200]);
    }
    const { cells } = runCompare(probe, vault, W, H);
    expect(cells.find((c) => c.x === 16 && c.y === 16)?.status).toBe('MODIFIED');
    expect(cells.filter((c) => c.status === 'ORIGINAL')).toHaveLength(15);
  });

  it('TEST 7 — crop does not label missing vault as AI; remaining blocks authenticate at offset', () => {
    const vault = uniquePattern(W, H);
    const cw = 16;
    const ch = 16;
    const ox = 8;
    const oy = 8;
    const crop = Buffer.alloc(cw * ch * 3);
    for (let y = 0; y < ch; y++) {
      vault.copy(crop, y * cw * 3, ((oy + y) * W + ox) * 3, ((oy + y) * W + ox) * 3 + cw * 3);
    }
    const tags = vaultTagsFromRgb({ rgb: vault, width: W, height: H, imageId: ID, blockSize: BLOCK });
    const { cells } = compareAlignedBlocks({
      probeRgb: crop,
      probeW: cw,
      probeH: ch,
      vaultRgb: vault,
      vaultW: W,
      vaultH: H,
      imageId: ID,
      vaultTags: tags,
      blockSize: BLOCK,
      alignment: offsetAlignment(ox, oy),
    });
    expect(cells.every((c) => c.status === 'ORIGINAL')).toBe(true);
    expect(cells.some((c) => c.status === 'MODIFIED')).toBe(false);
  });

  it('TEST 8 — resize is not cryptographic equality (UNKNOWN geometry)', () => {
    const vault = uniquePattern(W, H);
    const small = uniquePattern(16, 16);
    const tags = vaultTagsFromRgb({ rgb: vault, width: W, height: H, imageId: ID, blockSize: BLOCK });
    const { cells } = compareAlignedBlocks({
      probeRgb: small,
      probeW: 16,
      probeH: 16,
      vaultRgb: vault,
      vaultW: W,
      vaultH: H,
      imageId: ID,
      vaultTags: tags,
      blockSize: BLOCK,
      alignment: { mode: 'none' },
    });
    expect(cells.every((c) => c.status === 'UNKNOWN')).toBe(true);
  });

  it('TEST 9 — JPEG compression does not pass HMAC as ORIGINAL', async () => {
    const vault = uniquePattern(W, H);
    const png = await sharp(vault, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    const jpg = await sharp(png).jpeg({ quality: 40 }).toBuffer();
    const { data, info } = await sharp(jpg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(W);
    const { cells } = runCompare(data, vault, W, H);
    expect(cells.some((c) => c.status === 'ORIGINAL')).toBe(false);
    expect(cells.every((c) => c.status === 'UNKNOWN' || c.status === 'MODIFIED')).toBe(true);
  });

  it('TEST 10 — low retrieval score refuses authentication', async () => {
    const png = await sharp(uniquePattern(W, H), { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
    const result = await investigateBlockDna({
      probeBuffer: png,
      vaultBuffer: png,
      vaultImageId: ID,
      vaultMatchId: 'vault-1',
      investigationId: 'inv-1',
      retrievalScore: 0.01,
    });
    expect(result.available).toBe(false);
    expect(result.authenticationStatus).toBe('NO_VAULT_MATCH');
  });

  it('TEST 11 — relocated 8×8 block fails coordinate-bound DNA', () => {
    const vault = uniquePattern(W, H);
    const probe = clone(vault);
    copyBlock(vault, W, probe, W, 0, 0, 16, 0, 8, 8);
    const { cells } = runCompare(probe, vault, W, H);
    expect(cells.find((c) => c.x === 16 && c.y === 0)?.status).toBe('MODIFIED');
    expect(cells.find((c) => c.x === 0 && c.y === 0)?.dnaVerified).toBe(true);
  });

  it('TEST 12 — block copied from another image fails (image id bound)', () => {
    const a = uniquePattern(W, H);
    const b = fillRgb(W, H, (x, y) => [(x * 3) % 256, (y * 5) % 256, 40]);
    const tagsA = vaultTagsFromRgb({ rgb: a, width: W, height: H, imageId: 'image-A', blockSize: BLOCK });
    const { cells } = compareAlignedBlocks({
      probeRgb: b,
      probeW: W,
      probeH: H,
      vaultRgb: a,
      vaultW: W,
      vaultH: H,
      imageId: 'image-A',
      vaultTags: tagsA,
      blockSize: BLOCK,
      alignment: identityAlignment(),
    });
    expect(cells.every((c) => c.dnaVerified === false)).toBe(true);
    expect(cells.every((c) => c.status !== 'ORIGINAL')).toBe(true);
  });

  it('identical pixels at different coordinates produce different DNA', () => {
    const rgb = Buffer.alloc(8 * 8 * 3, 77);
    const t0 = computeBlockDnaHmac({
      imageId: ID,
      imageWidth: 32,
      imageHeight: 32,
      blockX: 0,
      blockY: 0,
      blockWidth: 8,
      blockHeight: 8,
      blockSize: 8,
      version: BLOCK_DNA_VERSION,
      blockRgb: rgb,
    });
    const t1 = computeBlockDnaHmac({
      imageId: ID,
      imageWidth: 32,
      imageHeight: 32,
      blockX: 8,
      blockY: 0,
      blockWidth: 8,
      blockHeight: 8,
      blockSize: 8,
      version: BLOCK_DNA_VERSION,
      blockRgb: rgb,
    });
    expect(t0.equals(t1)).toBe(false);
  });
});
