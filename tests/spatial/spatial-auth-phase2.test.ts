/**
 * Spatial Auth Phase 2 — block-level tamper localization tests (A–J)
 * Plus Phase 1 regression smoke + performance.
 */

import sharp from 'sharp';
import {
  buildSpatialAuthPackageFromRgb,
  verifyExactSpatialAuth,
  buildBlockGrid,
  buildSpatialBlockLocalization,
  findConnectedTamperRegions,
  maskByteToStatus,
} from '../../src/services/spatial';
import { spatialLocalizationForTamperAnalysis } from '../../src/services/spatial/integration';
import type { SpatialAuthPackageData } from '../../src/services/spatial/types';

const MASTER = 'phase2-spatial-auth-secret';
const KEY_ID = 'spatial-key-v1';

function setPixel(rgb: Buffer, width: number, x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * width + x) * 3;
  rgb[i] = r;
  rgb[i + 1] = g;
  rgb[i + 2] = b;
}

function enroll(rgb: Buffer, w: number, h: number, dna = 'p2-dna-1', ref = 'seal:p2'): SpatialAuthPackageData {
  return buildSpatialAuthPackageFromRgb({
    rgb,
    width: w,
    height: h,
    dnaRecordId: dna,
    ownerUserId: 'p2-owner',
    globalDnaRef: ref,
    scales: [64, 128],
    primaryScale: 64,
    keyId: KEY_ID,
    masterSecret: MASTER,
  }).packageData;
}

async function patterned(w: number, h: number): Promise<{ rgb: Buffer; width: number; height: number }> {
  const { data, info } = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 20, g: 40, b: 60 } },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      setPixel(data, w, x, y, (x * 3) % 256, (y * 5) % 256, (x + y) % 256);
    }
  }
  return { rgb: data, width: info.width, height: info.height };
}

describe('Spatial Auth Phase 2 — localization', () => {
  // A
  it('A: one-pixel → exactly one block TAMPERED; neighbors AUTHENTIC', async () => {
    const { rgb, width, height } = await patterned(256, 256);
    const pkg = enroll(rgb, width, height);
    const t = Buffer.from(rgb);
    setPixel(t, width, 100, 100, 255, 0, 0);

    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
      includeGridPreview: true,
    });

    expect(result.status).toBe('TAMPERED');
    expect(result.localization).toBeTruthy();
    const loc = result.localization!;
    expect(loc.derivedEvidenceOnly).toBe(true);
    expect(loc.tamperedBlocks.length).toBe(1);
    const tb = loc.tamperedBlocks[0]!;
    expect(100 >= tb.x && 100 < tb.x + tb.width).toBe(true);
    expect(100 >= tb.y && 100 < tb.y + tb.height).toBe(true);
    expect(loc.stats.blocksFailed).toBe(1);
    expect(loc.regions.length).toBe(1);
    expect(loc.pattern.pattern).toBe('LOCAL_MODIFICATION');
    // Neighbors authentic
    const authentic = loc.blocks.filter((b) => b.status === 'AUTHENTIC');
    expect(authentic.length).toBe(loc.stats.blocksPassed);
    expect(loc.blocks.every((b) => b.status !== 'UNKNOWN')).toBe(true);
  });

  // B
  it('B: three separated mods → three blocks fail → three regions', async () => {
    const { rgb, width, height } = await patterned(320, 320);
    const pkg = enroll(rgb, width, height);
    const t = Buffer.from(rgb);
    const pts = [
      { x: 10, y: 10 },
      { x: 200, y: 10 },
      { x: 10, y: 200 },
    ];
    for (const p of pts) setPixel(t, width, p.x, p.y, 1, 2, 3);

    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    const loc = result.localization!;
    expect(loc.stats.blocksFailed).toBe(3);
    expect(loc.regions.length).toBe(3);
    expect(loc.pattern.pattern).toBe('MULTIPLE_LOCAL_MODIFICATIONS');
  });

  // C
  it('C: 2×2 block modification → one connected region of 4', async () => {
    const { rgb, width, height } = await patterned(256, 256);
    const pkg = enroll(rgb, width, height);
    const t = Buffer.from(rgb);
    // Paint full 128×128 at (0,0) spanning four 64×64 blocks
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) setPixel(t, width, x, y, 9, 9, 9);
    }

    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    const loc = result.localization!;
    expect(loc.stats.blocksFailed).toBe(4);
    expect(loc.regions.length).toBe(1);
    expect(loc.regions[0]!.blocks).toBe(4);
  });

  // D
  it('D: boundary pixel → correct adjacent block(s)', async () => {
    const { rgb, width, height } = await patterned(192, 192);
    const pkg = enroll(rgb, width, height);

    // Pixel on shared vertical boundary belonging to block starting at x=64
    const t1 = Buffer.from(rgb);
    setPixel(t1, width, 64, 30, 255, 255, 255);
    const r1 = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t1,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(r1.localization!.tamperedBlocks.length).toBe(1);
    expect(r1.localization!.tamperedBlocks[0]!.x).toBe(64);

    // Corner of four blocks: modify 63,63 and 64,64 separately already covered;
    // modify pixel that is only in one block at edge of four-way: (63,63) in (0,0) block
    const t2 = Buffer.from(rgb);
    setPixel(t2, width, 63, 63, 0, 0, 0);
    setPixel(t2, width, 64, 63, 0, 0, 0);
    setPixel(t2, width, 63, 64, 0, 0, 0);
    setPixel(t2, width, 64, 64, 0, 0, 0);
    const r2 = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t2,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(r2.localization!.stats.blocksFailed).toBe(4);
    expect(r2.localization!.regions.length).toBe(1);
  });

  // E
  it('E: full-image modification → GLOBAL pattern', async () => {
    const { rgb, width, height } = await patterned(128, 128);
    const pkg = enroll(rgb, width, height);
    const t = Buffer.alloc(rgb.length, 200);
    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    const loc = result.localization!;
    expect(loc.stats.blocksFailed).toBe(loc.stats.blocksChecked);
    expect(loc.pattern.pattern).toBe('GLOBAL_MODIFICATION');
  });

  // F
  it('F: no modification → no tampered regions', async () => {
    const { rgb, width, height } = await patterned(160, 160);
    const pkg = enroll(rgb, width, height);
    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: Buffer.from(rgb),
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('MATCH');
    expect(result.localization!.stats.blocksFailed).toBe(0);
    expect(result.localization!.regions.length).toBe(0);
    expect(result.localization!.pattern.pattern).toBe('NONE');
    expect(result.localization!.mask.byteLength).toBe(result.localization!.blocks.length);
  });

  // G
  it('G: edge partial block dimensions preserved', async () => {
    const { rgb, width, height } = await patterned(100, 50); // not divisible by 64
    const pkg = enroll(rgb, width, height);
    const edge = buildBlockGrid(width, height, 64).find((b) => b.x === 64);
    expect(edge!.width).toBe(36);
    expect(edge!.height).toBe(50);

    const t = Buffer.from(rgb);
    setPixel(t, width, 90, 10, 1, 1, 1); // in partial edge block
    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    const tb = result.localization!.tamperedBlocks[0]!;
    expect(tb.width).toBe(36);
    expect(tb.height).toBe(50);
    expect(tb.x).toBe(64);
  });

  // H
  it('H: invalid package → no trusted tamper map', async () => {
    const { rgb, width, height } = await patterned(128, 128);
    const pkg = enroll(rgb, width, height);
    const bad = { ...pkg, merkleRoot: '0'.repeat(64) };
    const result = verifyExactSpatialAuth({
      packageData: bad,
      candidateRgb: rgb,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('INVALID_AUTH_PACKAGE');
    expect(result.localization).toBeNull();
    const summary = spatialLocalizationForTamperAnalysis(result);
    expect(summary?.['available']).toBe(false);
  });

  // I
  it('I: dimension mismatch → no fabricated tamper map', async () => {
    const { rgb, width, height } = await patterned(128, 128);
    const pkg = enroll(rgb, width, height);
    const small = await patterned(64, 64);
    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: small.rgb,
      candidateWidth: small.width,
      candidateHeight: small.height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('DIMENSION_MISMATCH');
    expect(result.localization).toBeNull();
    expect(result.matched).toBe(false);
  });

  // Boundary extras from requirements
  it('center / image-edge / across-two-blocks', async () => {
    const { rgb, width, height } = await patterned(192, 192);
    const pkg = enroll(rgb, width, height);

    // Center of block (0,0)
    const c = Buffer.from(rgb);
    setPixel(c, width, 32, 32, 50, 50, 50);
    const rc = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: c,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(rc.localization!.tamperedBlocks[0]!.blockId).toBe(0);

    // Image edge
    const e = Buffer.from(rgb);
    setPixel(e, width, width - 1, height - 1, 7, 7, 7);
    const re = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: e,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(re.localization!.stats.blocksFailed).toBe(1);

    // Across two adjacent blocks (horizontal)
    const a = Buffer.from(rgb);
    setPixel(a, width, 63, 10, 8, 8, 8);
    setPixel(a, width, 64, 10, 8, 8, 8);
    const ra = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: a,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(ra.localization!.stats.blocksFailed).toBe(2);
    expect(ra.localization!.regions.length).toBe(1);
  });

  it('mask bytes are block-accurate (no blur)', () => {
    const blocks = [
      { blockId: 0, x: 0, y: 0, width: 64, height: 64, scale: 64, status: 'AUTHENTIC' as const },
      { blockId: 1, x: 64, y: 0, width: 64, height: 64, scale: 64, status: 'TAMPERED' as const },
    ];
    const loc = buildSpatialBlockLocalization({
      imageWidth: 128,
      imageHeight: 64,
      primaryScale: 64,
      hmacPassedByBlockId: new Map([
        [0, true],
        [1, false],
      ]),
    });
    const raw = Buffer.from(loc.mask.dataBase64, 'base64');
    expect(maskByteToStatus(raw[0]!)).toBe('AUTHENTIC');
    expect(maskByteToStatus(raw[1]!)).toBe('TAMPERED');
    expect(loc.mask.format).toBe('block-byte-v1');
    void blocks;
    void findConnectedTamperRegions;
  });
});

describe('Spatial Auth Phase 2 — Phase 1 regression smoke', () => {
  it('J: original MATCH still works with localization attached', async () => {
    const { rgb, width, height } = await patterned(128, 96);
    const pkg = enroll(rgb, width, height);
    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: Buffer.from(rgb),
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('MATCH');
    expect(result.merkleRootMatch).toBe(true);
    expect(result.rootMacValid).toBe(true);
    expect(result.exactPassRate).toBe(1);
    expect(result.localization!.stats.blocksFailed).toBe(0);
  });
});

describe('Spatial Auth Phase 2 — performance', () => {
  const cases = [
    { label: '1MP', w: 1000, h: 1000 },
    { label: '5MP', w: 2560, h: 1920 },
    { label: '12MP', w: 4000, h: 3000 },
  ];

  for (const c of cases) {
    it(`perf ${c.label}`, async () => {
      const { data, info } = await sharp({
        create: { width: c.w, height: c.h, channels: 3, background: { r: 30, g: 60, b: 90 } },
      })
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += 97) data[i] = (data[i]! + (i % 17)) % 256;

      const mem0 = process.memoryUsage().heapUsed;
      const { packageData } = buildSpatialAuthPackageFromRgb({
        rgb: data,
        width: info.width,
        height: info.height,
        dnaRecordId: `p2-perf-${c.label}`,
        ownerUserId: 'p2-owner',
        globalDnaRef: `seal:p2-${c.label}`,
        scales: [64, 128],
        primaryScale: 64,
        keyId: KEY_ID,
        masterSecret: MASTER,
      });

      // Introduce one-pixel tamper for localization path
      setPixel(data, info.width, 100, 100, 255, 0, 0);

      const t0 = Date.now();
      const result = verifyExactSpatialAuth({
        packageData,
        candidateRgb: data,
        candidateWidth: info.width,
        candidateHeight: info.height,
        masterSecret: MASTER,
      });
      const totalMs = Date.now() - t0;
      const mem1 = process.memoryUsage().heapUsed;

      const loc = result.localization!;
      // eslint-disable-next-line no-console
      console.log(
        `[p2-perf] ${c.label}: verify=${totalMs}ms locMs=${result.localizationMs}ms ` +
          `maskGen=${loc.maskGenerationMs}ms regions=${loc.regionAnalysisMs}ms ` +
          `maskBytes=${loc.mask.byteLength} heapDeltaMB=${((mem1 - mem0) / 1048576).toFixed(2)} ` +
          `failed=${loc.stats.blocksFailed}`,
      );

      expect(result.status).toBe('TAMPERED');
      expect(loc.mask.byteLength).toBe(loc.stats.blocksChecked);
      expect(loc.maskGenerationMs + loc.regionAnalysisMs).toBeLessThanOrEqual(totalMs + 5);
    }, 180_000);
  }
});
