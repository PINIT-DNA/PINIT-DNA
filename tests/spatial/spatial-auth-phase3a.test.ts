/**
 * Phase 3A — 8×8 HKCA tests (server-side only, no GLPM)
 * Localization claim: 8×8 cells — NOT exact single-pixel identification.
 */

import sharp from 'sharp';
import {
  buildSpatialAuthPackageFromRgb,
  verifyExactSpatialAuth,
  buildPixelAuthPackageFromRgb,
  verifyPixelAuthLayer,
  buildPixelCellGrid,
} from '../../src/services/spatial';
import type { SpatialAuthPackageData } from '../../src/services/spatial/types';

const MASTER = 'phase3a-hkca-secret';
const KEY = 'spatial-key-v1';

function setPixel(rgb: Buffer, w: number, x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * w + x) * 3;
  rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
}

async function patterned(w: number, h: number) {
  const { data, info } = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) setPixel(data, w, x, y, (x * 2) % 256, (y * 3) % 256, (x + y) % 256);
  }
  return { rgb: data, width: info.width, height: info.height };
}

function enrollFull(rgb: Buffer, w: number, h: number, dna = 'p3a-dna', ref = 'seal:p3a'): SpatialAuthPackageData {
  const { packageData } = buildSpatialAuthPackageFromRgb({
    rgb, width: w, height: h,
    dnaRecordId: dna, ownerUserId: 'p3a-owner', globalDnaRef: ref,
    scales: [64, 128], primaryScale: 64, keyId: KEY, masterSecret: MASTER,
  });
  const { pixel } = buildPixelAuthPackageFromRgb({
    rgb, width: w, height: h,
    dnaRecordId: dna, ownerUserId: 'p3a-owner', globalDnaRef: ref,
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

describe('Phase 3A HKCA — tag size evaluation note', () => {
  it('documents finalized default tagBytes=8 (16 optional)', () => {
    const { spatialPixelAuthConfig } = require('../../src/config/spatial-pixel-auth') as typeof import('../../src/config/spatial-pixel-auth');
    expect([8, 16]).toContain(spatialPixelAuthConfig.tagBytes);
    expect(spatialPixelAuthConfig.glpmEnabled).toBe(false);
    expect(spatialPixelAuthConfig.cellSize).toBe(8);
  });
});

describe('Phase 3A HKCA — exact integrity', () => {
  it('original → MATCH at block + pixel layer; localizationClaim 8x8_cell', async () => {
    const { rgb, width, height } = await patterned(128, 96);
    const pkg = enrollFull(rgb, width, height);
    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: Buffer.from(rgb),
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('MATCH');
    expect(result.pixelLayer?.status).toBe('MATCH');
    expect(result.fineLocalization?.localizationClaim).toBe('8x8_cell');
    expect(result.fineLocalization?.stats.cellsFailed).toBe(0);
    expect(result.fineLocalization?.stats.localizationUnitPx).toBe(8);
  });

  it('one-pixel change → Phase1 block + Phase3 8×8 cell fail (not single-pixel claim)', async () => {
    const { rgb, width, height } = await patterned(160, 160);
    const pkg = enrollFull(rgb, width, height);
    const t = Buffer.from(rgb);
    const px = 40;
    const py = 50;
    setPixel(t, width, px, py, 255, 0, 0);

    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('TAMPERED');
    expect(result.localization!.stats.blocksFailed).toBeGreaterThanOrEqual(1);
    expect(result.pixelLayer?.status).toBe('TAMPERED');
    expect(result.fineLocalization!.stats.cellsFailed).toBeGreaterThanOrEqual(1);

    const cell = result.fineLocalization!.tamperedCells.find(
      (c) => px >= c.x && px < c.x + c.width && py >= c.y && py < c.y + c.height,
    );
    expect(cell).toBeDefined();
    expect(cell!.width).toBeLessThanOrEqual(8);
    expect(cell!.height).toBeLessThanOrEqual(8);
    // Honest claim: cell contains pixel — we do NOT assert exact pixel id
    expect(result.fineLocalization!.localizationClaim).toBe('8x8_cell');
  });

  it('10×10 region → multiple cells; regions formed', async () => {
    const { rgb, width, height } = await patterned(128, 128);
    const pkg = enrollFull(rgb, width, height);
    const t = Buffer.from(rgb);
    for (let y = 16; y < 26; y++) {
      for (let x = 16; x < 26; x++) setPixel(t, width, x, y, 1, 1, 1);
    }
    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(result.pixelLayer?.status).toBe('TAMPERED');
    expect(result.fineLocalization!.stats.cellsFailed).toBeGreaterThanOrEqual(1);
    expect(result.fineLocalization!.regions.length).toBeGreaterThanOrEqual(1);
  });

  it('invalid pixelRootMac → INVALID_PIXEL_PACKAGE; fineLocalization null', async () => {
    const { rgb, width, height } = await patterned(64, 64);
    const pkg = enrollFull(rgb, width, height);
    const bad = { ...pkg, pixelRootMac: 'a'.repeat(64) };
    const result = verifyExactSpatialAuth({
      packageData: bad,
      candidateRgb: rgb,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    // Phase 1 may still MATCH; pixel layer invalid
    expect(result.pixelLayer?.status).toBe('INVALID_PIXEL_PACKAGE');
    expect(result.fineLocalization).toBeNull();
  });

  it('dimension mismatch → pixel layer SKIPPED; no fabricated fine map', async () => {
    const { rgb, width, height } = await patterned(128, 128);
    const pkg = enrollFull(rgb, width, height);
    const small = await patterned(64, 64);
    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: small.rgb,
      candidateWidth: small.width,
      candidateHeight: small.height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('DIMENSION_MISMATCH');
    expect(result.fineLocalization).toBeNull();
    expect(result.pixelLayer).toBeNull();
  });

  it('edge partial 8×8 cell dimensions preserved', () => {
    const grid = buildPixelCellGrid(100, 50, 8);
    const edge = grid.find((c) => c.x === 96);
    expect(edge!.width).toBe(4);
    expect(edge!.height).toBe(8);
  });

  it('16-byte tags also verify', async () => {
    const { rgb, width, height } = await patterned(64, 64);
    const { packageData } = buildSpatialAuthPackageFromRgb({
      rgb, width, height,
      dnaRecordId: 'p3a-16', ownerUserId: 'o', globalDnaRef: 'seal:16',
      scales: [64], primaryScale: 64, keyId: KEY, masterSecret: MASTER,
    });
    const { pixel } = buildPixelAuthPackageFromRgb({
      rgb, width, height,
      dnaRecordId: 'p3a-16', ownerUserId: 'o', globalDnaRef: 'seal:16',
      keyId: KEY, tagBytes: 16, masterSecret: MASTER,
    });
    expect(pixel.tagBytes).toBe(16);
    const vr = verifyPixelAuthLayer({
      pixel,
      dnaRecordId: 'p3a-16',
      ownerUserId: 'o',
      width, height,
      globalDnaRef: 'seal:16',
      candidateRgb: rgb,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(vr.status).toBe('MATCH');
    void packageData;
  });

  it('no blue-channel write: enroll does not mutate RGB', async () => {
    const { rgb, width, height } = await patterned(48, 48);
    const before = Buffer.from(rgb);
    buildPixelAuthPackageFromRgb({
      rgb, width, height,
      dnaRecordId: 'p3a-noglpm', ownerUserId: 'o', globalDnaRef: 'seal:x',
      masterSecret: MASTER,
    });
    expect(rgb.equals(before)).toBe(true);
  });
});

describe('Phase 3A — Phase 1/2 regression smoke', () => {
  it('Phase1 MATCH without pixel fields still works', async () => {
    const { rgb, width, height } = await patterned(96, 96);
    const { packageData } = buildSpatialAuthPackageFromRgb({
      rgb, width, height,
      dnaRecordId: 'p1-only', ownerUserId: 'o', globalDnaRef: 'seal:p1',
      scales: [64, 128], primaryScale: 64, keyId: KEY, masterSecret: MASTER,
    });
    const result = verifyExactSpatialAuth({
      packageData,
      candidateRgb: rgb,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('MATCH');
    expect(result.localization!.stats.blocksFailed).toBe(0);
    expect(result.pixelLayer).toBeNull();
    expect(result.fineLocalization).toBeNull();
  });
});

describe('Phase 3A — performance + storage', () => {
  const cases = [
    { label: '1MP', w: 1000, h: 1000 },
    { label: '5MP', w: 2560, h: 1920 },
  ];

  for (const c of cases) {
    it(`enroll+verify ${c.label} tagBytes=8`, async () => {
      const { data, info } = await sharp({
        create: { width: c.w, height: c.h, channels: 3, background: { r: 40, g: 50, b: 60 } },
      }).raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 101) data[i] = (data[i]! + i) % 256;

      const t0 = Date.now();
      const { pixel, enrollment } = buildPixelAuthPackageFromRgb({
        rgb: data,
        width: info.width,
        height: info.height,
        dnaRecordId: `perf-${c.label}`,
        ownerUserId: 'o',
        globalDnaRef: `seal:${c.label}`,
        tagBytes: 8,
        masterSecret: MASTER,
      });
      const enrollMs = Date.now() - t0;

      setPixel(data, info.width, 100, 100, 255, 0, 0);
      const t1 = Date.now();
      const vr = verifyPixelAuthLayer({
        pixel,
        dnaRecordId: `perf-${c.label}`,
        ownerUserId: 'o',
        width: info.width,
        height: info.height,
        globalDnaRef: `seal:${c.label}`,
        candidateRgb: data,
        candidateWidth: info.width,
        candidateHeight: info.height,
        masterSecret: MASTER,
      });
      const verifyMs = Date.now() - t1;

      // eslint-disable-next-line no-console
      console.log(
        `[p3a-perf] ${c.label}: cells=${enrollment.cellCount} blob=${enrollment.blobBytes}B ` +
          `tagBytes=${enrollment.tagBytes} enroll=${enrollMs}ms verify=${verifyMs}ms status=${vr.status} failed=${vr.cellsFailed}`,
      );
      expect(vr.status).toBe('TAMPERED');
      expect(vr.fineLocalization!.localizationClaim).toBe('8x8_cell');
    }, 180_000);
  }
});
