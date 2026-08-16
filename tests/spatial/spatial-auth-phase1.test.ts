/**
 * Spatial Auth Phase 1 — Mode A exact block authentication tests (A–J + perf)
 */

import sharp from 'sharp';
import {
  buildBlockGrid,
  extractBlockRgb,
  buildSpatialAuthPackageFromRgb,
  verifyExactSpatialAuth,
  decodeBlockBlob,
  merkleRootHex,
  computeRootMac,
  computeBlockAuthTag,
} from '../../src/services/spatial';
import { authenticateBlocksForScale } from '../../src/services/spatial/block-auth';
import { deriveSpatialBlockKey } from '../../src/services/spatial/key-derivation';
import { SPATIAL_AUTH_ALGORITHM_VERSION } from '../../src/config/spatial-auth';
import type { SpatialAuthPackageData } from '../../src/services/spatial/types';

const MASTER = 'test-spatial-auth-secret-phase1';
const KEY_ID = 'spatial-key-v1-test';

async function makeRgb(
  w: number,
  h: number,
  background: { r: number; g: number; b: number } = { r: 40, g: 90, b: 160 },
): Promise<{ rgb: Buffer; width: number; height: number }> {
  const { data, info } = await sharp({
    create: { width: w, height: h, channels: 3, background },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgb: data, width: info.width, height: info.height };
}

async function rgbToPng(rgb: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

function enroll(
  rgb: Buffer,
  width: number,
  height: number,
  dnaRecordId: string,
  ownerUserId: string,
  globalDnaRef = 'seal:test-global-dna-ref',
  scales = [64, 128],
): SpatialAuthPackageData {
  const { packageData } = buildSpatialAuthPackageFromRgb({
    rgb,
    width,
    height,
    dnaRecordId,
    ownerUserId,
    globalDnaRef,
    scales,
    primaryScale: 64,
    keyId: KEY_ID,
    masterSecret: MASTER,
  });
  return packageData;
}

function setPixel(rgb: Buffer, width: number, x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * width + x) * 3;
  rgb[i] = r;
  rgb[i + 1] = g;
  rgb[i + 2] = b;
}

function copyBlock(
  src: Buffer,
  srcW: number,
  dst: Buffer,
  dstW: number,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  bw: number,
  bh: number,
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

describe('Spatial Auth Phase 1 — Mode A', () => {
  const dnaId = '11111111-1111-4111-8111-111111111111';
  const ownerId = '22222222-2222-4222-8222-222222222222';

  // ── Test A ───────────────────────────────────────────────────────────────
  it('Test A: original image PASS (MATCH)', async () => {
    const { rgb, width, height } = await makeRgb(192, 160);
    // Paint unique pattern so blocks differ
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        setPixel(rgb, width, x, y, (x * 3) % 256, (y * 5) % 256, (x + y) % 256);
      }
    }
    const pkg = enroll(rgb, width, height, dnaId, ownerId);
    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: Buffer.from(rgb),
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('MATCH');
    expect(result.matched).toBe(true);
    expect(result.tampered).toBe(false);
    expect(result.blocksFailed).toBe(0);
    expect(result.merkleRootMatch).toBe(true);
    expect(result.rootMacValid).toBe(true);
    expect(result.packageIntegrityValid).toBe(true);
  });

  // ── Test B ───────────────────────────────────────────────────────────────
  it('Test B: one pixel change → corresponding block MUST fail', async () => {
    const { rgb, width, height } = await makeRgb(192, 160);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        setPixel(rgb, width, x, y, x % 256, y % 256, 100);
      }
    }
    const pkg = enroll(rgb, width, height, dnaId, ownerId);
    const tampered = Buffer.from(rgb);
    const px = 70;
    const py = 70; // inside block at (64,64) → blockId depends on grid
    setPixel(tampered, width, px, py, 255, 0, 0);

    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: tampered,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('TAMPERED');
    expect(result.matched).toBe(false);
    expect(result.blocksFailed).toBeGreaterThanOrEqual(1);
    const hit = result.tamperedBlocks.find(
      (b) => b.scale === 64 && px >= b.x && px < b.x + b.width && py >= b.y && py < b.y + b.height,
    );
    expect(hit).toBeDefined();
    expect(hit!.status).toBe('TAMPERED');
  });

  // ── Test C ───────────────────────────────────────────────────────────────
  it('Test C: two pixels in different blocks → both blocks fail', async () => {
    const { rgb, width, height } = await makeRgb(192, 160);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        setPixel(rgb, width, x, y, (x + 1) % 256, (y + 2) % 256, 50);
      }
    }
    const pkg = enroll(rgb, width, height, dnaId, ownerId);
    const tampered = Buffer.from(rgb);
    setPixel(tampered, width, 10, 10, 1, 2, 3);   // block (0,0)
    setPixel(tampered, width, 100, 100, 4, 5, 6); // different block

    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: tampered,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('TAMPERED');
    expect(result.blocksFailed).toBeGreaterThanOrEqual(2);
    const ids = new Set(result.tamperedBlocks.filter((b) => b.scale === 64).map((b) => b.blockId));
    expect(ids.size).toBeGreaterThanOrEqual(2);
  });

  // ── Test D ───────────────────────────────────────────────────────────────
  it('Test D: move a block to another location → authentication fails', async () => {
    const { rgb, width, height } = await makeRgb(192, 160);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        setPixel(rgb, width, x, y, (x * 7) % 256, (y * 11) % 256, (x * y) % 256);
      }
    }
    const pkg = enroll(rgb, width, height, dnaId, ownerId);
    const moved = Buffer.from(rgb);
    // Swap 64×64 region at (0,0) with (64,0)
    const tmp = Buffer.alloc(64 * 64 * 3);
    copyBlock(moved, width, tmp, 64, 0, 0, 0, 0, 64, 64);
    copyBlock(moved, width, moved, width, 64, 0, 0, 0, 64, 64);
    copyBlock(tmp, 64, moved, width, 0, 0, 64, 0, 64, 64);

    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: moved,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('TAMPERED');
    expect(result.blocksFailed).toBeGreaterThanOrEqual(1);
  });

  // ── Test E ───────────────────────────────────────────────────────────────
  it('Test E: block from another registered image → authentication fails', async () => {
    const a = await makeRgb(128, 128, { r: 10, g: 20, b: 30 });
    const b = await makeRgb(128, 128, { r: 200, g: 100, b: 50 });
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        setPixel(a.rgb, 128, x, y, x % 256, y % 256, 1);
        setPixel(b.rgb, 128, x, y, (255 - x) % 256, (255 - y) % 256, 2);
      }
    }
    const dnaA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const dnaB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const pkgB = enroll(b.rgb, 128, 128, dnaB, ownerId, 'seal:image-b');

    const hybrid = Buffer.from(b.rgb);
    copyBlock(a.rgb, 128, hybrid, 128, 0, 0, 0, 0, 64, 64);

    const result = verifyExactSpatialAuth({
      packageData: pkgB,
      candidateRgb: hybrid,
      candidateWidth: 128,
      candidateHeight: 128,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('TAMPERED');
    expect(result.blocksFailed).toBeGreaterThanOrEqual(1);
    void dnaA;
  });

  // ── Test F ───────────────────────────────────────────────────────────────
  it('Test F: dimension change → DIMENSION_MISMATCH (not exact tamper)', async () => {
    const { rgb, width, height } = await makeRgb(128, 128);
    const pkg = enroll(rgb, width, height, dnaId, ownerId);
    const resized = await makeRgb(96, 96);
    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: resized.rgb,
      candidateWidth: resized.width,
      candidateHeight: resized.height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('DIMENSION_MISMATCH');
    expect(result.matched).toBe(false);
    expect(result.tampered).toBe(false);
  });

  // ── Test G ───────────────────────────────────────────────────────────────
  it('Test G: EXIF-only change with same normalized pixels → PASS', async () => {
    const { rgb, width, height } = await makeRgb(128, 96);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        setPixel(rgb, width, x, y, 80, 120, (x + y) % 256);
      }
    }
    const pkg = enroll(rgb, width, height, dnaId, ownerId);

    // Same pixels, PNG vs JPEG with metadata — decode policy uses raw RGB
    const png = await rgbToPng(rgb, width, height);
    const jpeg = await sharp(png)
      .jpeg({ quality: 100 })
      .withMetadata({ exif: { IFD0: { Copyright: 'tampered-meta-only' } } })
      .toBuffer();

    // Round-trip JPEG at q=100 may still alter pixels slightly — for EXIF policy test,
    // re-decode PNG path and attach only via sharp metadata on lossless PNG.
    const pngWithMeta = await sharp(png)
      .png()
      .withMetadata({ exif: { IFD0: { ImageDescription: 'exif-only-change' } } })
      .toBuffer();

    const { decodeImageForSpatialAuth } = await import('../../src/services/spatial/image-decode');
    const decoded = await decodeImageForSpatialAuth(pngWithMeta);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);

    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: decoded.rgb,
      candidateWidth: decoded.width,
      candidateHeight: decoded.height,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('MATCH');
    void jpeg;
  });

  // ── Test H ───────────────────────────────────────────────────────────────
  it('Test H: different image same dimensions → MUST fail', async () => {
    const a = await makeRgb(160, 160, { r: 1, g: 2, b: 3 });
    const b = await makeRgb(160, 160, { r: 9, g: 8, b: 7 });
    for (let i = 0; i < a.rgb.length; i++) a.rgb[i] = i % 256;
    for (let i = 0; i < b.rgb.length; i++) b.rgb[i] = (255 - i) % 256;

    const pkg = enroll(a.rgb, 160, 160, dnaId, ownerId);
    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: b.rgb,
      candidateWidth: 160,
      candidateHeight: 160,
      masterSecret: MASTER,
    });
    expect(result.status).toBe('TAMPERED');
    expect(result.blocksFailed).toBeGreaterThan(0);
  });

  // ── Test I ───────────────────────────────────────────────────────────────
  it('Test I: pixel at block boundary → correct block(s) fail', async () => {
    const { rgb, width, height } = await makeRgb(128, 128);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        setPixel(rgb, width, x, y, x % 200, y % 200, 33);
      }
    }
    const pkg = enroll(rgb, width, height, dnaId, ownerId);
    const tampered = Buffer.from(rgb);
    // Boundary pixel belonging to block starting at (64,0): x=64 is first col of that block
    setPixel(tampered, width, 64, 0, 255, 255, 255);

    const result = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: tampered,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
      primaryScaleOnly: true,
    });
    expect(result.status).toBe('TAMPERED');
    const scale64 = result.tamperedBlocks.filter((b) => b.scale === 64);
    expect(scale64.length).toBe(1);
    expect(scale64[0]!.x).toBe(64);
    expect(scale64[0]!.y).toBe(0);
  });

  // ── Test J ───────────────────────────────────────────────────────────────
  it('Test J: tampered SpatialAuthPackage / Merkle root → INVALID_AUTH_PACKAGE', async () => {
    const { rgb, width, height } = await makeRgb(128, 128);
    const pkg = enroll(rgb, width, height, dnaId, ownerId);

    const badRoot = {
      ...pkg,
      merkleRoot: '0'.repeat(64),
    };
    const r1 = verifyExactSpatialAuth({
      packageData: badRoot,
      candidateRgb: rgb,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(r1.status).toBe('INVALID_AUTH_PACKAGE');
    expect(r1.rootMacValid).toBe(false);

    // Forge merkleRoot + rootMac together but corrupt blockBlob leaf tag
    const decoded = decodeBlockBlob(pkg.blockBlob);
    const leaves = decoded.leaves.map((l, i) =>
      i === 0 ? { ...l, tag: Buffer.alloc(16, 0xab) } : l,
    );
    const { encodeBlockBlob } = await import('../../src/services/spatial/block-blob');
    const corruptBlob = encodeBlockBlob({
      algorithmVersion: pkg.algorithmVersion,
      primaryScale: pkg.primaryScale,
      leaves,
    });
    // Keep original merkleRoot + rootMac → blob/root mismatch
    const badBlob = { ...pkg, blockBlob: corruptBlob };
    const r2 = verifyExactSpatialAuth({
      packageData: badBlob,
      candidateRgb: rgb,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(r2.status).toBe('INVALID_AUTH_PACKAGE');
    expect(r2.packageIntegrityValid).toBe(false);
  });

  it('edge blocks record actual width/height for non-multiples', () => {
    const grid = buildBlockGrid(100, 50, 64);
    const edge = grid.find((b) => b.x === 64 && b.y === 0);
    expect(edge).toBeDefined();
    expect(edge!.width).toBe(36);
    expect(edge!.height).toBe(50);
  });

  it('position binding: same pixels different (x,y) produce different tags', () => {
    const blockRgb = Buffer.alloc(64 * 64 * 3, 77);
    const key = deriveSpatialBlockKey({
      dnaRecordId: dnaId,
      ownerUserId: ownerId,
      globalDnaRef: 'seal:x',
      keyId: KEY_ID,
      masterSecret: MASTER,
    });
    const t1 = computeBlockAuthTag({
      imageKey: key,
      algorithmVersion: SPATIAL_AUTH_ALGORITHM_VERSION,
      dnaRecordId: dnaId,
      globalDnaRef: 'seal:x',
      scale: 64,
      blockId: 0,
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      blockRgb,
    });
    const t2 = computeBlockAuthTag({
      imageKey: key,
      algorithmVersion: SPATIAL_AUTH_ALGORITHM_VERSION,
      dnaRecordId: dnaId,
      globalDnaRef: 'seal:x',
      scale: 64,
      blockId: 1,
      x: 64,
      y: 0,
      width: 64,
      height: 64,
      blockRgb,
    });
    expect(t1.equals(t2)).toBe(false);
    void extractBlockRgb;
    void authenticateBlocksForScale;
    void merkleRootHex;
    void computeRootMac;
  });
});

describe('Spatial Auth Phase 1 — performance', () => {
  const cases = [
    { label: '1MP', w: 1000, h: 1000 },
    { label: '5MP', w: 2560, h: 1920 },
    { label: '12MP', w: 4000, h: 3000 },
  ];

  for (const c of cases) {
    it(`measures enrollment + verify for ${c.label} (${c.w}x${c.h})`, async () => {
      const { data, info } = await sharp({
        create: {
          width: c.w,
          height: c.h,
          channels: 3,
          background: { r: 30, g: 60, b: 90 },
        },
      })
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Light unique noise so blocks are not identical (still cheap)
      for (let i = 0; i < data.length; i += 97) {
        data[i] = (data[i]! + (i % 17)) % 256;
      }

      const t0 = Date.now();
      const { packageData, enrollment } = buildSpatialAuthPackageFromRgb({
        rgb: data,
        width: info.width,
        height: info.height,
        dnaRecordId: `perf-${c.label}`,
        ownerUserId: 'perf-owner',
        globalDnaRef: `seal:perf-${c.label}`,
        scales: [64, 128],
        primaryScale: 64,
        keyId: KEY_ID,
        masterSecret: MASTER,
      });
      const enrollMs = Date.now() - t0;

      const t1 = Date.now();
      const result = verifyExactSpatialAuth({
        packageData,
        candidateRgb: data,
        candidateWidth: info.width,
        candidateHeight: info.height,
        masterSecret: MASTER,
        primaryScaleOnly: true,
      });
      const verifyMs = Date.now() - t1;

      // eslint-disable-next-line no-console
      console.log(
        `[spatial-perf] ${c.label}: blocks=${enrollment.blockCount} ` +
          `blob=${enrollment.packageBytes}B enroll=${enrollMs}ms ` +
          `verify=${verifyMs}ms status=${result.status}`,
      );

      expect(result.status).toBe('MATCH');
      expect(enrollment.blockCount).toBeGreaterThan(0);
      expect(enrollment.packageBytes).toBeGreaterThan(0);
    }, 180_000);
  }
});
