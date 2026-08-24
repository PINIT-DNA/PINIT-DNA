/**
 * Phase 4D — true 1×1 pixel authentication (lazy under failed 2×2)
 * Production global claim stays 8x8_cell; trusted layer claim is 1x1_pixel.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  buildSpatialAuthPackageFromRgb,
  buildPixelAuthPackageFromRgb,
  buildPixel1AuthPackageFromRgb,
  verifyExactSpatialAuth,
  decodeImageForSpatialAuth,
  ancestryForPixel,
  subdivideUnit,
  verifyExclusiveCoverage,
  SPATIAL_HIERARCHY_PRODUCTION_CLAIM,
  computePixel1AuthTag,
  deriveSpatialPixel1Key,
  PIXEL1_HKDF_INFO,
  PIXEL1_MAC_DOMAIN,
  QUAD2_HKDF_INFO,
  QUAD4_HKDF_INFO,
} from '../../src/services/spatial';
import type { SpatialAuthPackageData } from '../../src/services/spatial/types';

const MASTER = 'phase4d-pixel1-secret';
const KEY = 'spatial-key-v1';
const DNA = '4d-dna-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = '4d-owner-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REF = 'seal:phase4d';
const REAL_IMAGE = path.resolve(__dirname, '../../tiger.jpeg');

function setPixel(rgb: Buffer, w: number, x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * w + x) * 3;
  rgb[i] = r;
  rgb[i + 1] = g;
  rgb[i + 2] = b;
}

function getPixel(rgb: Buffer, w: number, x: number, y: number): { r: number; g: number; b: number } {
  const i = (y * w + x) * 3;
  return { r: rgb[i]!, g: rgb[i + 1]!, b: rgb[i + 2]! };
}

function bumpChannel(rgb: Buffer, w: number, x: number, y: number, ch: 0 | 1 | 2, delta: number): void {
  const i = (y * w + x) * 3 + ch;
  rgb[i] = (rgb[i]! + delta + 256) % 256;
}

function copyRect(
  src: Buffer, srcW: number, dst: Buffer, dstW: number,
  sx: number, sy: number, dx: number, dy: number, bw: number, bh: number,
): void {
  for (let row = 0; row < bh; row++) {
    for (let col = 0; col < bw; col++) {
      const s = ((sy + row) * srcW + (sx + col)) * 3;
      const d = ((dy + row) * dstW + (dx + col)) * 3;
      dst[d] = src[s]!;
      dst[d + 1] = src[s + 1]!;
      dst[d + 2] = src[s + 2]!;
    }
  }
}

function fillRect(
  rgb: Buffer, w: number, x0: number, y0: number, rw: number, rh: number, r: number, g: number, b: number,
): Set<string> {
  const mods = new Set<string>();
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      setPixel(rgb, w, x, y, r, g, b);
      mods.add(`${x},${y}`);
    }
  }
  return mods;
}

function pk(x: number, y: number): string {
  return `${x},${y}`;
}

function precisionRecall(modified: Set<string>, tampered: { x: number; y: number }[]): {
  tp: number; fp: number; fn: number; precision: number; recall: number;
} {
  const T = new Set(tampered.map((p) => pk(p.x, p.y)));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const k of T) {
    if (modified.has(k)) tp++;
    else fp++;
  }
  for (const k of modified) {
    if (!T.has(k)) fn++;
  }
  return {
    tp, fp, fn,
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
  };
}

async function patterned(w: number, h: number, seed = 0): Promise<{ rgb: Buffer; width: number; height: number }> {
  const { data, info } = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 14 + seed, g: 28, b: 42 } },
  }).raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      setPixel(data, w, x, y, (x * 5 + seed) % 256, (y * 9 + seed) % 256, (x + y + seed) % 256);
    }
  }
  return { rgb: data, width: info.width, height: info.height };
}

function enroll(rgb: Buffer, width: number, height: number, dna = DNA, ref = REF): SpatialAuthPackageData {
  const { packageData } = buildSpatialAuthPackageFromRgb({
    rgb, width, height,
    dnaRecordId: dna, ownerUserId: OWNER, globalDnaRef: ref,
    scales: [64, 128], primaryScale: 64, keyId: KEY, masterSecret: MASTER,
  });
  const { pixel } = buildPixelAuthPackageFromRgb({
    rgb, width, height,
    dnaRecordId: dna, ownerUserId: OWNER, globalDnaRef: ref,
    keyId: KEY, tagBytes: 8, masterSecret: MASTER,
  });
  const p1 =
    process.env['SPATIAL_1X1_AUTH_ENABLED'] === 'true'
      ? buildPixel1AuthPackageFromRgb({
          rgb, width, height,
          dnaRecordId: dna, ownerUserId: OWNER, globalDnaRef: ref,
          keyId: KEY, tagBytes: 8, masterSecret: MASTER,
        })
      : null;
  return {
    ...packageData,
    pixelAlgoVersion: pixel.algorithmVersion,
    pixelScheme: pixel.scheme,
    pixelKeyId: pixel.keyId,
    pixelCellSize: pixel.cellSize,
    pixelTagBytes: pixel.tagBytes,
    pixelAuthBlob: pixel.pixelAuthBlob,
    pixelAuthRoot: pixel.pixelAuthRoot,
    pixelRootMac: pixel.pixelRootMac,
    ...(p1
      ? {
          pixel1AlgoVersion: p1.algorithmVersion,
          pixel1KeyId: p1.keyId,
          pixel1TagBytes: p1.tagBytes,
          pixel1AuthBlob: p1.pixel1AuthBlob,
          pixel1AuthRoot: p1.pixel1AuthRoot,
          pixel1RootMac: p1.pixel1RootMac,
        }
      : {}),
  };
}

function verify(
  pkg: SpatialAuthPackageData,
  cand: Buffer,
  ref: Buffer,
  w: number,
  h: number,
  secret = MASTER,
) {
  return verifyExactSpatialAuth({
    packageData: pkg,
    candidateRgb: cand,
    candidateWidth: w,
    candidateHeight: h,
    referenceRgb: ref,
    referenceWidth: w,
    referenceHeight: h,
    masterSecret: secret,
  });
}

function enableAllFineFlags(): void {
  process.env['SPATIAL_4X4_AUTH_ENABLED'] = 'true';
  process.env['SPATIAL_2X2_AUTH_ENABLED'] = 'true';
  process.env['SPATIAL_1X1_AUTH_ENABLED'] = 'true';
}

function clearFineFlags(): void {
  delete process.env['SPATIAL_4X4_AUTH_ENABLED'];
  delete process.env['SPATIAL_2X2_AUTH_ENABLED'];
  delete process.env['SPATIAL_1X1_AUTH_ENABLED'];
}

describe('Phase 4D — 1×1 pixel authentication', () => {
  jest.setTimeout(180_000);

  let orig: Buffer;
  let width: number;
  let height: number;
  let pkg: SpatialAuthPackageData;

  beforeAll(async () => {
    enableAllFineFlags();
    const img = await patterned(256, 256);
    orig = img.rgb;
    width = img.width;
    height = img.height;
    pkg = enroll(orig, width, height);
  });

  afterAll(() => {
    clearFineFlags();
  });

  it('1. Original — MATCH, zero 1×1 tampered', () => {
    const r = verify(pkg, orig, orig, width, height);
    expect(r.status).toBe('MATCH');
    expect(r.pixel1Localization?.trusted).toBe(true);
    expect(r.pixel1Localization?.tamperedPixels.length).toBe(0);
    expect(r.pixel1Localization?.stats.pixelsInspected).toBe(0);
    expect(r.pixel1Localization?.localizationClaim).toBe('1x1_pixel');
    expect(SPATIAL_HIERARCHY_PRODUCTION_CLAIM).toBe('8x8_cell');
  });

  async function onePixelChannel(label: string, ch: 0 | 1 | 2, delta: number): Promise<void> {
    const img = await patterned(640, 640);
    const p = enroll(img.rgb, 640, 640, DNA + label, REF + label);
    const t = Buffer.from(img.rgb);
    bumpChannel(t, 640, 400, 500, ch, delta);
    const r = verify(p, t, img.rgb, 640, 640);
    expect(r.status).toBe('TAMPERED');
    expect(r.quad2Localization!.tamperedCells[0]).toMatchObject({ x: 400, y: 500, width: 2, height: 2 });
    const p1 = r.pixel1Localization!;
    expect(p1.trusted).toBe(true);
    expect(p1.localizationClaim).toBe('1x1_pixel');
    expect(p1.tamperedPixels.length).toBe(1);
    expect(p1.tamperedPixels[0]).toMatchObject({ x: 400, y: 500 });
    expect(p1.pixels.length).toBe(4);
    expect(p1.pixels.filter((px) => px.status === 'AUTHENTIC').length).toBe(3);
    const sibs = p1.pixels.filter((px) => !(px.x === 400 && px.y === 500));
    expect(sibs.every((px) => px.status === 'AUTHENTIC')).toBe(true);
    const pr = precisionRecall(new Set(['400,500']), p1.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  }

  it('2. R +1 at (400,500)', async () => { await onePixelChannel('-rp', 0, 1); });
  it('3. R -1 at (400,500)', async () => { await onePixelChannel('-rm', 0, -1); });
  it('4. G +1 at (400,500)', async () => { await onePixelChannel('-gp', 1, 1); });
  it('5. G -1 at (400,500)', async () => { await onePixelChannel('-gm', 1, -1); });
  it('6. B +1 at (400,500)', async () => { await onePixelChannel('-bp', 2, 1); });
  it('7. B -1 at (400,500)', async () => { await onePixelChannel('-bm', 2, -1); });

  it('8. Completely different RGB at (400,500)', async () => {
    const img = await patterned(640, 640);
    const p = enroll(img.rgb, 640, 640, DNA + '-rgb', REF + '-rgb');
    const t = Buffer.from(img.rgb);
    setPixel(t, 640, 400, 500, 1, 2, 3);
    const r = verify(p, t, img.rgb, 640, 640);
    expect(r.pixel1Localization!.tamperedPixels).toEqual([
      expect.objectContaining({ x: 400, y: 500, status: 'TAMPERED' }),
    ]);
    expect(r.pixel1Localization!.pixels.filter((px) => px.status === 'AUTHENTIC').length).toBe(3);
  });

  it('9. Two adjacent pixels', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-adj', REF + '-adj');
    const t = Buffer.from(img.rgb);
    const mods = new Set(['16,16', '17,16']);
    bumpChannel(t, 256, 16, 16, 0, 1);
    bumpChannel(t, 256, 17, 16, 0, 1);
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('10. Two diagonal pixels', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-diag', REF + '-diag');
    const t = Buffer.from(img.rgb);
    const mods = new Set(['16,16', '17,17']);
    bumpChannel(t, 256, 16, 16, 0, 1);
    bumpChannel(t, 256, 17, 17, 0, 1);
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('11. Two separated pixels', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-sep', REF + '-sep');
    const t = Buffer.from(img.rgb);
    const mods = new Set(['16,16', '100,100']);
    bumpChannel(t, 256, 16, 16, 0, 1);
    bumpChannel(t, 256, 100, 100, 0, 1);
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('12. 10 random pixels', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-r10', REF + '-r10');
    const t = Buffer.from(img.rgb);
    const mods = new Set<string>();
    const pts = [[8, 8], [20, 30], [40, 41], [60, 90], [100, 50], [120, 120], [140, 80], [160, 200], [180, 10], [200, 220]];
    for (const [x, y] of pts) {
      bumpChannel(t, 256, x!, y!, 0, 1);
      mods.add(pk(x!, y!));
    }
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('13. 100 random pixels', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-r100', REF + '-r100');
    const t = Buffer.from(img.rgb);
    const mods = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const x = (i * 17 + 3) % 256;
      const y = (i * 29 + 7) % 256;
      if (mods.has(pk(x, y))) continue;
      bumpChannel(t, 256, x, y, (i % 3) as 0 | 1 | 2, 1);
      mods.add(pk(x, y));
    }
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('14. Full 2×2 modification', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-f2', REF + '-f2');
    const t = Buffer.from(img.rgb);
    const mods = fillRect(t, 256, 16, 16, 2, 2, 9, 9, 9);
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
    expect(r.pixel1Localization!.stats.pixelsInspected).toBe(4);
  });

  it('15. 2×2 boundary', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-b2', REF + '-b2');
    const t = Buffer.from(img.rgb);
    const mods = new Set(['17,16', '18,16']);
    bumpChannel(t, 256, 17, 16, 0, 1);
    bumpChannel(t, 256, 18, 16, 0, 1);
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('16. 4×4 boundary', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-b4', REF + '-b4');
    const t = Buffer.from(img.rgb);
    const mods = new Set(['19,16', '20,16']);
    bumpChannel(t, 256, 19, 16, 0, 1);
    bumpChannel(t, 256, 20, 16, 0, 1);
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('17. 8×8 boundary', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-b8', REF + '-b8');
    const t = Buffer.from(img.rgb);
    const mods = new Set(['15,16', '16,16']);
    bumpChannel(t, 256, 15, 16, 0, 1);
    bumpChannel(t, 256, 16, 16, 0, 1);
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('18. 64×64 boundary', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-b64', REF + '-b64');
    const t = Buffer.from(img.rgb);
    const mods = new Set(['63,64', '64,64']);
    bumpChannel(t, 256, 63, 64, 0, 1);
    bumpChannel(t, 256, 64, 64, 0, 1);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.localization!.tamperedBlocks.length).toBe(2);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('19. 10×10 region', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-10', REF + '-10');
    const t = Buffer.from(img.rgb);
    const mods = fillRect(t, 256, 32, 32, 10, 10, 200, 10, 10);
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('20. 100×100 region', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-100', REF + '-100');
    const t = Buffer.from(img.rgb);
    const mods = fillRect(t, 256, 20, 20, 100, 100, 11, 22, 33);
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('21. Three separated regions', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-3r', REF + '-3r');
    const t = Buffer.from(img.rgb);
    const mods = new Set<string>();
    for (const [x, y] of [[8, 8], [100, 100], [200, 200]] as const) {
      bumpChannel(t, 256, x, y, 0, 1);
      mods.add(pk(x, y));
    }
    const r = verify(p, t, img.rgb, 256, 256);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('22. Top-left (0,0)', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-tl', REF + '-tl');
    const t = Buffer.from(img.rgb);
    bumpChannel(t, 256, 0, 0, 0, 1);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.pixel1Localization!.tamperedPixels).toEqual([
      expect.objectContaining({ x: 0, y: 0 }),
    ]);
  });

  it('23. Bottom-right', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-br', REF + '-br');
    const t = Buffer.from(img.rgb);
    bumpChannel(t, 256, 255, 255, 0, 1);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.pixel1Localization!.tamperedPixels[0]).toMatchObject({ x: 255, y: 255 });
  });

  it('24. Image edge (odd 131×131)', async () => {
    const img = await patterned(131, 131);
    expect(verifyExclusiveCoverage(131, 131, 1).complete).toBe(true);
    const p = enroll(img.rgb, 131, 131, DNA + '-edge', REF + '-edge');
    const t = Buffer.from(img.rgb);
    bumpChannel(t, 131, 130, 0, 0, 1);
    bumpChannel(t, 131, 0, 130, 1, 1);
    bumpChannel(t, 131, 130, 130, 2, 1);
    const r = verify(p, t, img.rgb, 131, 131);
    const mods = new Set(['130,0', '0,130', '130,130']);
    const pr = precisionRecall(mods, r.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it('25. Internal hierarchy ancestry (400,500)', () => {
    const a = ancestryForPixel(640, 640, 400, 500);
    expect(a.levels['1x1']).toMatchObject({ x: 400, y: 500, width: 1, height: 1 });
    const kids = subdivideUnit(
      { unitId: a.levels['2x2'].unitId, scale: 2, x: 400, y: 500, width: 2, height: 2 },
      640, 640, 1,
    );
    expect(kids.map((c) => pk(c.x, c.y)).sort()).toEqual(['400,500', '400,501', '401,500', '401,501'].sort());
  });

  it('26. Cross-image pixel transplant', async () => {
    const a = await patterned(256, 256, 1);
    const b = await patterned(256, 256, 99);
    const pb = enroll(b.rgb, 256, 256, DNA + '-xp', REF + '-xp');
    const t = Buffer.from(b.rgb);
    copyRect(a.rgb, 256, t, 256, 40, 40, 40, 40, 1, 1);
    const r = verify(pb, t, b.rgb, 256, 256);
    expect(r.status).toBe('TAMPERED');
    expect(r.pixel1Localization!.tamperedPixels.some((p) => p.x === 40 && p.y === 40)).toBe(true);
  });

  it('27. Cross-image 2×2 transplant', async () => {
    const a = await patterned(256, 256, 1);
    const b = await patterned(256, 256, 99);
    const pb = enroll(b.rgb, 256, 256, DNA + '-x2', REF + '-x2');
    const t = Buffer.from(b.rgb);
    copyRect(a.rgb, 256, t, 256, 0, 0, 16, 16, 2, 2);
    const r = verify(pb, t, b.rgb, 256, 256);
    expect(r.pixel1Localization!.tamperedPixels.length).toBeGreaterThanOrEqual(1);
  });

  it('28. Pixel relocation', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-rel', REF + '-rel');
    const t = Buffer.from(img.rgb);
    const src = getPixel(img.rgb, 256, 16, 16);
    setPixel(t, 256, 64, 64, src.r, src.g, src.b);
    setPixel(t, 256, 16, 16, 0, 0, 0);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.pixel1Localization!.tamperedPixels.length).toBeGreaterThanOrEqual(1);
  });

  it('29. Coordinate binding — tag differs by x/y', () => {
    const key = deriveSpatialPixel1Key({
      dnaRecordId: DNA, ownerUserId: OWNER, globalDnaRef: REF, keyId: KEY, masterSecret: MASTER,
    });
    const a = computePixel1AuthTag({
      pixel1Key: key, algorithmVersion: 'spatial-pixel1-auth-v1',
      dnaRecordId: DNA, globalDnaRef: REF, parentCellId: 1, x: 10, y: 10,
      width: 1, height: 1, r: 1, g: 2, b: 3,
    });
    const b = computePixel1AuthTag({
      pixel1Key: key, algorithmVersion: 'spatial-pixel1-auth-v1',
      dnaRecordId: DNA, globalDnaRef: REF, parentCellId: 1, x: 11, y: 10,
      width: 1, height: 1, r: 1, g: 2, b: 3,
    });
    expect(a.equals(b)).toBe(false);
  });

  it('30. DNA manipulation', () => {
    const r = verify(
      { ...pkg, dnaRecordId: 'forged-dna-id-0000-0000-000000000001' },
      orig, orig, width, height,
    );
    expect(r.status).toBe('INVALID_AUTH_PACKAGE');
  });

  it('31. Wrong secret', () => {
    const t = Buffer.from(orig);
    bumpChannel(t, width, 20, 20, 0, 1);
    const r = verify(pkg, t, orig, width, height, 'wrong-secret');
    expect(r.status).toBe('INVALID_AUTH_PACKAGE');
  });

  it('32. Invalid package', () => {
    const r = verifyExactSpatialAuth({
      packageData: { ...pkg, rootMac: '00'.repeat(32) },
      candidateRgb: orig,
      candidateWidth: width,
      candidateHeight: height,
      referenceRgb: orig,
      masterSecret: MASTER,
    });
    expect(r.status).toBe('INVALID_AUTH_PACKAGE');
  });

  it('33. Forged pixel tag / RGB binding', () => {
    const key = deriveSpatialPixel1Key({
      dnaRecordId: DNA, ownerUserId: OWNER, globalDnaRef: REF, keyId: KEY, masterSecret: MASTER,
    });
    const good = computePixel1AuthTag({
      pixel1Key: key, algorithmVersion: 'spatial-pixel1-auth-v1',
      dnaRecordId: DNA, globalDnaRef: REF, parentCellId: 1, x: 5, y: 5,
      width: 1, height: 1, r: 10, g: 20, b: 30,
    });
    const forged = computePixel1AuthTag({
      pixel1Key: key, algorithmVersion: 'spatial-pixel1-auth-v1',
      dnaRecordId: DNA, globalDnaRef: REF, parentCellId: 1, x: 5, y: 5,
      width: 1, height: 1, r: 11, g: 20, b: 30,
    });
    expect(good.equals(forged)).toBe(false);
  });

  it('34. Parent mismatch domains distinct', () => {
    expect(PIXEL1_HKDF_INFO).toBe('pinit-spatial-pixel1-hmac-v1');
    expect(PIXEL1_MAC_DOMAIN).toBe('P1');
    expect(PIXEL1_HKDF_INFO).not.toBe(QUAD2_HKDF_INFO);
    expect(PIXEL1_HKDF_INFO).not.toBe(QUAD4_HKDF_INFO);
  });

  it('35. Wrong reference image', async () => {
    const a = await patterned(256, 256, 1);
    const b = await patterned(256, 256, 2);
    const p = enroll(a.rgb, 256, 256, DNA + '-wr', REF + '-wr');
    const t = Buffer.from(a.rgb);
    bumpChannel(t, 256, 40, 40, 0, 1);
    const r = verifyExactSpatialAuth({
      packageData: p,
      candidateRgb: t,
      candidateWidth: 256,
      candidateHeight: 256,
      referenceRgb: b.rgb,
      referenceWidth: 256,
      referenceHeight: 256,
      masterSecret: MASTER,
    });
    expect(r.pixel1Localization?.trusted).toBe(false);
    expect(r.pixel1Localization?.unavailableReason).toMatch(/PARENT_2X2_UNTRUSTED/);
  });

  it('36. Missing reference', () => {
    const t = Buffer.from(orig);
    bumpChannel(t, width, 30, 30, 0, 1);
    const r = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(r.pixel1Localization?.trusted).toBe(false);
    expect(r.pixel1Localization?.unavailableReason).toMatch(/PARENT_2X2_UNTRUSTED|REFERENCE/);
  });

  it('37. Dimension mismatch', () => {
    const r = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: Buffer.alloc(128 * 128 * 3),
      candidateWidth: 128,
      candidateHeight: 128,
      referenceRgb: orig,
      referenceWidth: width,
      referenceHeight: height,
      masterSecret: MASTER,
    });
    expect(r.status).toBe('DIMENSION_MISMATCH');
  });

  it('38. Unsupported version', () => {
    const r = verifyExactSpatialAuth({
      packageData: { ...pkg, algorithmVersion: 'spatial-auth-v9.9' },
      candidateRgb: orig,
      candidateWidth: width,
      candidateHeight: height,
      referenceRgb: orig,
      masterSecret: MASTER,
    });
    expect(r.status).toBe('UNSUPPORTED_VERSION');
  });

  it('39. Feature flag OFF', () => {
    process.env['SPATIAL_1X1_AUTH_ENABLED'] = 'false';
    const t = Buffer.from(orig);
    bumpChannel(t, width, 24, 24, 0, 1);
    const r = verify(pkg, t, orig, width, height);
    expect(r.quad2Localization?.trusted).toBe(true);
    expect(r.pixel1Localization == null).toBe(true);
    process.env['SPATIAL_1X1_AUTH_ENABLED'] = 'true';
  });

  it('40. No false positives (repeat)', () => {
    for (let i = 0; i < 3; i++) {
      const r = verify(pkg, orig, orig, width, height);
      expect(r.status).toBe('MATCH');
      expect(r.pixel1Localization!.tamperedPixels.length).toBe(0);
    }
  });

  it('41. Lazy scope — one pixel inspects ≤4', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-lazy', REF + '-lazy');
    const t = Buffer.from(img.rgb);
    bumpChannel(t, 256, 20, 20, 0, 1);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.pixel1Localization!.stats.parentsInspected).toBe(1);
    expect(r.pixel1Localization!.stats.pixelsInspected).toBeLessThanOrEqual(4);
    // eslint-disable-next-line no-console
    console.log(
      `[4d-perf-lazy] parents=${r.pixel1Localization!.stats.parentsInspected} ` +
        `px=${r.pixel1Localization!.stats.pixelsInspected} ` +
        `cmpMs=${r.pixel1Localization!.stats.comparisonMs} ` +
        `authMs=${r.pixel1Localization!.stats.authMs} ` +
        `pixel1Ms=${r.pixel1VerificationMs} totalMs=${r.verificationMs}`,
    );
  });

  it('42. Real image tiger.jpeg — original / one-pixel / multi / region', async () => {
    expect(fs.existsSync(REAL_IMAGE)).toBe(true);
    const decoded = await decodeImageForSpatialAuth(fs.readFileSync(REAL_IMAGE));
    const { rgb, width: w, height: h } = decoded;
    const p = enroll(rgb, w, h, DNA + '-tiger', REF + '-tiger');

    const clean = verify(p, rgb, rgb, w, h);
    expect(clean.status).toBe('MATCH');
    expect(clean.pixel1Localization!.tamperedPixels.length).toBe(0);

    const tx = Math.min(400, w - 1);
    const ty = Math.min(500, h - 1);
    const one = Buffer.from(rgb);
    bumpChannel(one, w, tx, ty, 0, 1);
    const r1 = verify(p, one, rgb, w, h);
    expect(r1.status).toBe('TAMPERED');
    expect(r1.pixel1Localization!.tamperedPixels.length).toBe(1);
    expect(r1.pixel1Localization!.tamperedPixels[0]).toMatchObject({ x: tx, y: ty });
    // eslint-disable-next-line no-console
    console.log(`[4d-real] one-pixel tampered=(${tx},${ty}) image=${w}x${h}`);

    const multi = Buffer.from(rgb);
    const mods = new Set<string>();
    for (const [x, y] of [[10, 10], [50, 80], [100, 120]] as const) {
      if (x < w && y < h) {
        bumpChannel(multi, w, x, y, 0, 1);
        mods.add(pk(x, y));
      }
    }
    const r2 = verify(p, multi, rgb, w, h);
    const pr = precisionRecall(mods, r2.pixel1Localization!.tamperedPixels);
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);

    const region = Buffer.from(rgb);
    const rw = Math.min(16, w);
    const rh = Math.min(16, h);
    const regionMods = fillRect(region, w, 8, 8, rw, rh, 7, 8, 9);
    const r3 = verify(p, region, rgb, w, h);
    const pr3 = precisionRecall(regionMods, r3.pixel1Localization!.tamperedPixels);
    expect(pr3.precision).toBe(1);
    expect(pr3.recall).toBe(1);
  });
});

describe('Phase 4D — megapixel performance (correctness-first)', () => {
  jest.setTimeout(600_000);

  beforeAll(() => {
    // Measure hierarchy cost without full-frame 1×1 enroll (Phase 4E covers enrolled 1×1 storage cost)
    process.env['SPATIAL_4X4_AUTH_ENABLED'] = 'true';
    process.env['SPATIAL_2X2_AUTH_ENABLED'] = 'true';
    delete process.env['SPATIAL_1X1_AUTH_ENABLED'];
  });
  afterAll(() => clearFineFlags());

  async function profile(side: number, label: string): Promise<void> {
    const img = await patterned(side, side);
    const p = enroll(img.rgb, side, side, DNA + label, REF + label);

    const t0 = Date.now();
    const clean = verify(p, img.rgb, img.rgb, side, side);
    const cleanMs = Date.now() - t0;
    expect(clean.status).toBe('MATCH');
    expect(clean.pixel1Localization == null).toBe(true);

    const one = Buffer.from(img.rgb);
    bumpChannel(one, side, Math.floor(side / 2), Math.floor(side / 2), 0, 1);
    const t1 = Date.now();
    const r1 = verify(p, one, img.rgb, side, side);
    const oneMs = Date.now() - t1;
    expect(r1.quad2Localization!.stats.pixelsReferenced).toBeLessThanOrEqual(16);

    const hundred = Buffer.from(img.rgb);
    for (let i = 0; i < 100; i++) {
      bumpChannel(hundred, side, (i * 13) % side, (i * 17) % side, 0, 1);
    }
    const t2 = Date.now();
    const r100 = verify(p, hundred, img.rgb, side, side);
    const hundredMs = Date.now() - t2;

    const box = Buffer.from(img.rgb);
    fillRect(box, side, 64, 64, 10, 10, 1, 2, 3);
    const t3 = Date.now();
    const rBox = verify(p, box, img.rgb, side, side);
    const boxMs = Date.now() - t3;

    // eslint-disable-next-line no-console
    console.log(
      `[4d-mp ${label}] clean=${cleanMs}ms one=${oneMs}ms(q2px=${r1.quad2Localization!.stats.pixelsReferenced}) ` +
        `100px=${hundredMs}ms(q2cells=${r100.quad2Localization!.stats.cellsInspected}) ` +
        `10x10=${boxMs}ms(q2cells=${rBox.quad2Localization!.stats.cellsInspected})`,
    );
  }

  it('1MP performance', async () => {
    await profile(1024, '-1mp');
  });

  it('5MP performance', async () => {
    await profile(2236, '-5mp');
  });

  it('12MP performance', async () => {
    await profile(3464, '-12mp');
  });
});
