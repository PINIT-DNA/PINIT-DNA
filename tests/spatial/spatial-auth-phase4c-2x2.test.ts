/**
 * Phase 4C — 2×2 cryptographic authentication (lazy under failed 4×4)
 * Does not implement 1×1 crypto. Production claim remains 8x8_cell.
 */

import sharp from 'sharp';
import {
  buildSpatialAuthPackageFromRgb,
  buildPixelAuthPackageFromRgb,
  verifyExactSpatialAuth,
  ancestryForPixel,
  subdivideUnit,
  verifyExclusiveCoverage,
  SPATIAL_HIERARCHY_PRODUCTION_CLAIM,
} from '../../src/services/spatial';
import type { SpatialAuthPackageData } from '../../src/services/spatial/types';

const MASTER = 'phase4c-quad2-secret';
const KEY = 'spatial-key-v1';
const DNA = '4c-dna-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = '4c-owner-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REF = 'seal:phase4c';

function setPixel(rgb: Buffer, w: number, x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * w + x) * 3;
  rgb[i] = r;
  rgb[i + 1] = g;
  rgb[i + 2] = b;
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
): void {
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) setPixel(rgb, w, x, y, r, g, b);
  }
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

describe('Phase 4C — 2×2 cryptographic authentication', () => {
  let orig: Buffer;
  let width: number;
  let height: number;
  let pkg: SpatialAuthPackageData;

  beforeAll(async () => {
    process.env['SPATIAL_4X4_AUTH_ENABLED'] = 'true';
    process.env['SPATIAL_2X2_AUTH_ENABLED'] = 'true';
    const img = await patterned(256, 256);
    orig = img.rgb;
    width = img.width;
    height = img.height;
    pkg = enroll(orig, width, height);
  });

  afterAll(() => {
    delete process.env['SPATIAL_4X4_AUTH_ENABLED'];
    delete process.env['SPATIAL_2X2_AUTH_ENABLED'];
  });

  it('1. Original image — MATCH, zero 2×2 tampered', () => {
    const r = verify(pkg, orig, orig, width, height);
    expect(r.status).toBe('MATCH');
    expect(r.pixelLayer?.status).toBe('MATCH');
    expect(r.quad4Localization?.trusted).toBe(true);
    expect(r.quad4Localization?.tamperedCells.length).toBe(0);
    expect(r.quad2Localization?.trusted).toBe(true);
    expect(r.quad2Localization?.tamperedCells.length).toBe(0);
    expect(r.quad2Localization?.productionClaim).toBe('8x8_cell');
    expect(r.quad2Localization?.localizationUnit).toBe('2x2_cell');
    expect(SPATIAL_HIERARCHY_PRODUCTION_CLAIM).toBe('8x8_cell');
  });

  it('2. One pixel (400,500) on 640 canvas — one 2×2 TAMPERED', async () => {
    const img = await patterned(640, 640);
    const p = enroll(img.rgb, img.width, img.height, DNA + '-640', REF + '-640');
    const t = Buffer.from(img.rgb);
    setPixel(t, img.width, 400, 500, 255, 0, 0);
    const r = verify(p, t, img.rgb, img.width, img.height);
    expect(r.status).toBe('TAMPERED');
    expect(r.fineLocalization!.tamperedCells[0]).toMatchObject({ x: 400, y: 496 });
    expect(r.quad4Localization!.tamperedCells[0]).toMatchObject({ x: 400, y: 500, width: 4, height: 4 });
    const q2 = r.quad2Localization!;
    expect(q2.trusted).toBe(true);
    expect(q2.tamperedCells.length).toBe(1);
    expect(q2.tamperedCells[0]).toMatchObject({ x: 400, y: 500, width: 2, height: 2 });
    expect(q2.cells.length).toBe(4);
    expect(q2.cells.filter((c) => c.status === 'AUTHENTIC').length).toBe(3);
    expect(q2.productionClaim).toBe('8x8_cell');
  });

  it('3. Two pixels same 2×2', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-s', REF + '-s');
    const t = Buffer.from(img.rgb);
    setPixel(t, 256, 16, 16, 1, 2, 3);
    setPixel(t, 256, 17, 17, 4, 5, 6);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.quad2Localization!.tamperedCells.length).toBe(1);
  });

  it('4. Two pixels different 2×2', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-d', REF + '-d');
    const t = Buffer.from(img.rgb);
    setPixel(t, 256, 16, 16, 9, 9, 9);
    setPixel(t, 256, 18, 16, 8, 8, 8); // adjacent 2×2 in same 4×4
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.quad4Localization!.tamperedCells.length).toBe(1);
    expect(r.quad2Localization!.tamperedCells.length).toBe(2);
  });

  it('5. Modification crosses 2×2 boundary', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-b2', REF + '-b2');
    const t = Buffer.from(img.rgb);
    setPixel(t, 256, 17, 16, 1, 1, 1);
    setPixel(t, 256, 18, 16, 2, 2, 2);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.quad2Localization!.tamperedCells.length).toBe(2);
  });

  it('6. Modification crosses 4×4 boundary', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-b4', REF + '-b4');
    const t = Buffer.from(img.rgb);
    setPixel(t, 256, 19, 16, 1, 1, 1);
    setPixel(t, 256, 20, 16, 2, 2, 2);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.quad4Localization!.tamperedCells.length).toBe(2);
    expect(r.quad2Localization!.stats.parentsInspected).toBe(2);
    expect(r.quad2Localization!.tamperedCells.length).toBe(2);
  });

  it('7. Modification crosses 8×8 boundary', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-b8', REF + '-b8');
    const t = Buffer.from(img.rgb);
    setPixel(t, 256, 15, 16, 1, 1, 1);
    setPixel(t, 256, 16, 16, 2, 2, 2);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.fineLocalization!.tamperedCells.length).toBe(2);
    expect(r.quad4Localization!.tamperedCells.length).toBe(2);
    expect(r.quad2Localization!.tamperedCells.length).toBe(2);
  });

  it('8. Full 2×2 region modified', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-f2', REF + '-f2');
    const t = Buffer.from(img.rgb);
    fillRect(t, 256, 16, 16, 2, 2, 200, 10, 10);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.quad2Localization!.tamperedCells.length).toBe(1);
    expect(r.quad2Localization!.cells.length).toBe(4);
  });

  it('9. Full 4×4 region modified — all four 2×2 TAMPERED', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-f4', REF + '-f4');
    const t = Buffer.from(img.rgb);
    fillRect(t, 256, 16, 16, 4, 4, 11, 22, 33);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.quad4Localization!.tamperedCells.length).toBe(1);
    expect(r.quad2Localization!.tamperedCells.length).toBe(4);
    expect(r.quad2Localization!.cells.length).toBe(4);
  });

  it('10. Full 8×8 region modified — sixteen 2×2 TAMPERED', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-f8', REF + '-f8');
    const t = Buffer.from(img.rgb);
    fillRect(t, 256, 16, 16, 8, 8, 44, 55, 66);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.fineLocalization!.tamperedCells.length).toBe(1);
    expect(r.quad4Localization!.tamperedCells.length).toBe(4);
    expect(r.quad2Localization!.stats.parentsInspected).toBe(4);
    expect(r.quad2Localization!.tamperedCells.length).toBe(16);
    expect(r.quad2Localization!.cells.length).toBe(16);
  });

  it('11. Multiple separated regions', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-m', REF + '-m');
    const t = Buffer.from(img.rgb);
    setPixel(t, 256, 8, 8, 1, 1, 1);
    setPixel(t, 256, 100, 100, 2, 2, 2);
    setPixel(t, 256, 200, 200, 3, 3, 3);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.quad2Localization!.tamperedCells.length).toBe(3);
  });

  it('12. Edge / partial cells (131×131)', async () => {
    const img = await patterned(131, 131);
    const p = enroll(img.rgb, 131, 131, DNA + '-e', REF + '-e');
    const cov = verifyExclusiveCoverage(131, 131, 2);
    expect(cov.complete).toBe(true);
    const t = Buffer.from(img.rgb);
    setPixel(t, 131, 130, 130, 9, 9, 9);
    const r = verify(p, t, img.rgb, 131, 131);
    expect(r.status).toBe('TAMPERED');
    expect(r.quad2Localization!.trusted).toBe(true);
    expect(r.quad2Localization!.tamperedCells.length).toBe(1);
    const tc = r.quad2Localization!.tamperedCells[0]!;
    expect(tc.x + tc.width).toBeLessThanOrEqual(131);
    expect(tc.y + tc.height).toBeLessThanOrEqual(131);
  });

  it('13. Cross-image 2×2 transplant', async () => {
    const a = await patterned(256, 256, 1);
    const b = await patterned(256, 256, 99);
    const pb = enroll(b.rgb, 256, 256, DNA + '-xb', REF + '-xb');
    const t = Buffer.from(b.rgb);
    copyRect(a.rgb, 256, t, 256, 0, 0, 16, 16, 2, 2);
    const r = verify(pb, t, b.rgb, 256, 256);
    expect(r.status).toBe('TAMPERED');
    expect(r.quad2Localization!.tamperedCells.length).toBeGreaterThanOrEqual(1);
  });

  it('14. Same-image 2×2 relocation', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-rel', REF + '-rel');
    const t = Buffer.from(img.rgb);
    copyRect(img.rgb, 256, t, 256, 16, 16, 64, 64, 2, 2);
    fillRect(t, 256, 16, 16, 2, 2, 0, 0, 0);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.quad2Localization!.tamperedCells.length).toBeGreaterThanOrEqual(2);
  });

  it('15. Wrong reference image', async () => {
    const a = await patterned(256, 256, 1);
    const b = await patterned(256, 256, 2);
    const p = enroll(a.rgb, 256, 256, DNA + '-wr', REF + '-wr');
    const t = Buffer.from(a.rgb);
    setPixel(t, 256, 40, 40, 1, 1, 1);
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
    expect(r.quad4Localization?.trusted).toBe(false);
    expect(r.quad2Localization?.trusted).toBe(false);
    expect(r.quad2Localization?.unavailableReason).toMatch(/PARENT_4X4_UNTRUSTED/);
  });

  it('16. Wrong secret', () => {
    const t = Buffer.from(orig);
    setPixel(t, width, 20, 20, 1, 1, 1);
    const r = verify(pkg, t, orig, width, height, 'wrong-secret');
    expect(r.status).toBe('INVALID_AUTH_PACKAGE');
    expect(r.quad2Localization == null || r.quad2Localization.trusted === false).toBe(true);
  });

  it('17. Invalid package', () => {
    const r = verifyExactSpatialAuth({
      packageData: { ...pkg, rootMac: '00'.repeat(32) },
      candidateRgb: orig,
      candidateWidth: width,
      candidateHeight: height,
      referenceRgb: orig,
      masterSecret: MASTER,
    });
    expect(r.status).toBe('INVALID_AUTH_PACKAGE');
    expect(r.quad2Localization == null || r.quad2Localization.trusted === false).toBe(true);
  });

  it('18. Parent/child geometry for (400,500)', () => {
    const a = ancestryForPixel(640, 640, 400, 500);
    expect(a.levels['4x4']).toMatchObject({ x: 400, y: 500, width: 4, height: 4 });
    expect(a.levels['2x2']).toMatchObject({ x: 400, y: 500, width: 2, height: 2 });
    const children = subdivideUnit(
      { unitId: a.levels['4x4'].unitId, scale: 4, x: 400, y: 500, width: 4, height: 4 },
      640, 640, 2,
    );
    expect(children.length).toBe(4);
    expect(children.map((c) => `${c.x},${c.y}`).sort()).toEqual([
      '400,500', '400,502', '402,500', '402,502',
    ].sort());
  });

  it('19. No false positives (covered by test 1)', () => {
    expect(true).toBe(true);
  });

  it('20. Lazy-scope performance — one failed 4×4 inspects exactly 4×2×2', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-perf', REF + '-perf');
    const t = Buffer.from(img.rgb);
    setPixel(t, 256, 20, 20, 7, 7, 7);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.quad4Localization!.tamperedCells.length).toBe(1);
    expect(r.quad2Localization!.stats.parentsInspected).toBe(1);
    expect(r.quad2Localization!.stats.cellsInspected).toBe(4);
    expect(r.quad2Localization!.stats.pixelsReferenced).toBeLessThanOrEqual(16);
    // eslint-disable-next-line no-console
    console.log(
      `[4c-perf] parents=${r.quad2Localization!.stats.parentsInspected} ` +
        `cells=${r.quad2Localization!.stats.cellsInspected} ` +
        `px=${r.quad2Localization!.stats.pixelsReferenced} ` +
        `cmpMs=${r.quad2Localization!.stats.comparisonMs} ` +
        `quad2Ms=${r.quad2VerificationMs}`,
    );
  });

  it('21. 2×2 OFF leaves prior behavior; PARENT_4X4_REQUIRED when 4×4 off', () => {
    process.env['SPATIAL_2X2_AUTH_ENABLED'] = 'false';
    const t = Buffer.from(orig);
    setPixel(t, width, 24, 24, 1, 1, 1);
    const rOff = verify(pkg, t, orig, width, height);
    expect(rOff.quad4Localization?.trusted).toBe(true);
    expect(rOff.quad2Localization == null).toBe(true);

    process.env['SPATIAL_2X2_AUTH_ENABLED'] = 'true';
    process.env['SPATIAL_4X4_AUTH_ENABLED'] = 'false';
    const rNo4 = verify(pkg, t, orig, width, height);
    expect(rNo4.quad4Localization == null).toBe(true);
    expect(rNo4.quad2Localization?.trusted).toBe(false);
    expect(rNo4.quad2Localization?.unavailableReason).toBe('PARENT_4X4_REQUIRED');

    process.env['SPATIAL_4X4_AUTH_ENABLED'] = 'true';
    process.env['SPATIAL_2X2_AUTH_ENABLED'] = 'true';
  });

  it('22. DNA id change invalidates before 2×2', () => {
    const r = verify(
      { ...pkg, dnaRecordId: 'forged-dna-id-0000-0000-000000000001' },
      orig, orig, width, height,
    );
    expect(r.status).toBe('INVALID_AUTH_PACKAGE');
  });

  it('23. Domains distinct from 4×4', () => {
    const { QUAD2_HKDF_INFO, QUAD2_MAC_DOMAIN, QUAD4_HKDF_INFO, QUAD4_MAC_DOMAIN } =
      require('../../src/services/spatial/hierarchy');
    expect(QUAD2_HKDF_INFO).toBe('pinit-spatial-quad2-hmac-v1');
    expect(QUAD2_MAC_DOMAIN).toBe('Q2');
    expect(QUAD2_HKDF_INFO).not.toBe(QUAD4_HKDF_INFO);
    expect(QUAD2_MAC_DOMAIN).not.toBe(QUAD4_MAC_DOMAIN);
  });
});
