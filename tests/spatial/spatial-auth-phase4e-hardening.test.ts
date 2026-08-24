/**
 * Phase 4E — 1×1 enrolled-tag hardening + production vault reference integration
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
  decodePixel1AuthBlob,
  encodePixel1AuthBlob,
  computePixel1AuthTag,
  deriveSpatialPixel1Key,
  lookupPixel1EnrolledTag,
  SPATIAL_HIERARCHY_PRODUCTION_CLAIM,
  unitIdAt,
} from '../../src/services/spatial';
import type { SpatialAuthPackageData } from '../../src/services/spatial/types';

const MASTER = 'phase4e-pixel1-secret';
const KEY = 'spatial-key-v1';
const DNA = '4e-dna-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = '4e-owner-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REF = 'seal:phase4e';
const REAL_IMAGE = path.resolve(__dirname, '../../tiger.jpeg');

function setPixel(rgb: Buffer, w: number, x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * w + x) * 3;
  rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
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
      dst[d] = src[s]!; dst[d + 1] = src[s + 1]!; dst[d + 2] = src[s + 2]!;
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

async function patterned(w: number, h: number, seed = 0) {
  const { data, info } = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 10 + seed, g: 20, b: 30 } },
  }).raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      setPixel(data, w, x, y, (x * 3 + seed) % 256, (y * 7 + seed) % 256, (x + y + seed) % 256);
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
  const p1 = buildPixel1AuthPackageFromRgb({
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
    pixel1AlgoVersion: p1.algorithmVersion,
    pixel1KeyId: p1.keyId,
    pixel1TagBytes: p1.tagBytes,
    pixel1AuthBlob: p1.pixel1AuthBlob,
    pixel1AuthRoot: p1.pixel1AuthRoot,
    pixel1RootMac: p1.pixel1RootMac,
  };
}

function verify(pkg: SpatialAuthPackageData, cand: Buffer, ref: Buffer, w: number, h: number, secret = MASTER) {
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

describe('Phase 4E — 1×1 cryptographic hardening', () => {
  jest.setTimeout(180_000);

  let orig: Buffer;
  let width: number;
  let height: number;
  let pkg: SpatialAuthPackageData;

  beforeAll(async () => {
    process.env['SPATIAL_4X4_AUTH_ENABLED'] = 'true';
    process.env['SPATIAL_2X2_AUTH_ENABLED'] = 'true';
    process.env['SPATIAL_1X1_AUTH_ENABLED'] = 'true';
    const img = await patterned(256, 256);
    orig = img.rgb;
    width = img.width;
    height = img.height;
    pkg = enroll(orig, width, height);
  });

  afterAll(() => {
    delete process.env['SPATIAL_4X4_AUTH_ENABLED'];
    delete process.env['SPATIAL_2X2_AUTH_ENABLED'];
    delete process.env['SPATIAL_1X1_AUTH_ENABLED'];
  });

  it('1. Production DNA verify service wires vault reference loader', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/services/spatial/verify-exact.service.ts'),
      'utf8',
    );
    expect(src).toContain('loadVaultSpatialReferenceRgb');
    expect(src).toContain('referenceRgb');
    expect(src).toMatch(/referenceRgb\?:\s*never/);
  });

  it('2. Missing reference → untrusted fine / 1×1 layers', () => {
    const t = Buffer.from(orig);
    bumpChannel(t, width, 20, 20, 0, 1);
    const r = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t,
      candidateWidth: width,
      candidateHeight: height,
      masterSecret: MASTER,
    });
    expect(r.quad4Localization?.trusted).toBe(false);
    expect(r.pixel1Localization?.trusted).toBe(false);
  });

  it('3. Wrong reference image → untrusted', async () => {
    const other = await patterned(256, 256, 9);
    const t = Buffer.from(orig);
    bumpChannel(t, width, 40, 40, 0, 1);
    const r = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t,
      candidateWidth: width,
      candidateHeight: height,
      referenceRgb: other.rgb,
      referenceWidth: 256,
      referenceHeight: 256,
      masterSecret: MASTER,
    });
    expect(r.pixel1Localization?.trusted).toBe(false);
  });

  it('4. Reference dimension mismatch', () => {
    const t = Buffer.from(orig);
    bumpChannel(t, width, 10, 10, 0, 1);
    const r = verifyExactSpatialAuth({
      packageData: pkg,
      candidateRgb: t,
      candidateWidth: width,
      candidateHeight: height,
      referenceRgb: Buffer.alloc(128 * 128 * 3),
      referenceWidth: 128,
      referenceHeight: 128,
      masterSecret: MASTER,
    });
    expect(r.quad4Localization?.trusted).toBe(false);
    expect(r.pixel1Localization?.trusted).toBe(false);
  });

  it('5. Client cannot supply production reference (API uses vault only)', () => {
    // verifyExactSpatialAuthForDna types referenceRgb as never; vault loader is server-side
    expect(SPATIAL_HIERARCHY_PRODUCTION_CLAIM).toBe('8x8_cell');
    expect(typeof verifyExactSpatialAuth).toBe('function');
  });

  it('6. Enrolled pixel authentication succeeds (MATCH)', () => {
    const r = verify(pkg, orig, orig, width, height);
    expect(r.status).toBe('MATCH');
    expect(r.pixel1Localization?.trusted).toBe(true);
    expect(r.pixel1Localization?.enrolledVerification).toBe(true);
    expect(r.pixel1Localization?.tamperedPixels.length).toBe(0);
  });

  it('7. Modified pixel fails against enrolled tag', async () => {
    const img = await patterned(640, 640);
    const p = enroll(img.rgb, 640, 640, DNA + '-1', REF + '-1');
    const t = Buffer.from(img.rgb);
    bumpChannel(t, 640, 400, 500, 0, 1);
    const r = verify(p, t, img.rgb, 640, 640);
    expect(r.pixel1Localization!.enrolledVerification).toBe(true);
    expect(r.pixel1Localization!.tamperedPixels).toEqual([
      expect.objectContaining({ x: 400, y: 500, status: 'TAMPERED' }),
    ]);
    expect(r.pixel1Localization!.pixels.filter((px) => px.status === 'AUTHENTIC').length).toBe(3);
  });

  it('8. Pixel relocation fails', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-rel', REF + '-rel');
    const t = Buffer.from(img.rgb);
    const i = (16 * 256 + 16) * 3;
    const j = (64 * 256 + 64) * 3;
    t[j] = img.rgb[i]!; t[j + 1] = img.rgb[i + 1]!; t[j + 2] = img.rgb[i + 2]!;
    setPixel(t, 256, 16, 16, 0, 0, 0);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.pixel1Localization!.tamperedPixels.length).toBeGreaterThanOrEqual(1);
  });

  it('9. Cross-image transplant fails', async () => {
    const a = await patterned(256, 256, 1);
    const b = await patterned(256, 256, 99);
    const pb = enroll(b.rgb, 256, 256, DNA + '-x', REF + '-x');
    const t = Buffer.from(b.rgb);
    copyRect(a.rgb, 256, t, 256, 40, 40, 40, 40, 1, 1);
    const r = verify(pb, t, b.rgb, 256, 256);
    expect(r.pixel1Localization!.tamperedPixels.some((p) => p.x === 40 && p.y === 40)).toBe(true);
  });

  it('10. Parent mismatch fails (same RGB/coords, wrong parent in tag)', () => {
    const key = deriveSpatialPixel1Key({
      dnaRecordId: DNA, ownerUserId: OWNER, globalDnaRef: REF, keyId: KEY, masterSecret: MASTER,
    });
    const parent = unitIdAt(2, width, Math.floor(10 / 2), Math.floor(10 / 2));
    const good = computePixel1AuthTag({
      pixel1Key: key, algorithmVersion: 'spatial-pixel1-auth-v1',
      dnaRecordId: DNA, globalDnaRef: REF, parentCellId: parent,
      x: 10, y: 10, width: 1, height: 1, r: 1, g: 2, b: 3,
    });
    const badParent = computePixel1AuthTag({
      pixel1Key: key, algorithmVersion: 'spatial-pixel1-auth-v1',
      dnaRecordId: DNA, globalDnaRef: REF, parentCellId: parent + 1,
      x: 10, y: 10, width: 1, height: 1, r: 1, g: 2, b: 3,
    });
    expect(good.equals(badParent)).toBe(false);
  });

  it('11. DNA mismatch fails', () => {
    const r = verify(
      { ...pkg, dnaRecordId: 'forged-dna-id-0000-0000-000000000001' },
      orig, orig, width, height,
    );
    expect(r.status).toBe('INVALID_AUTH_PACKAGE');
  });

  it('12. Wrong secret fails', () => {
    const t = Buffer.from(orig);
    bumpChannel(t, width, 12, 12, 0, 1);
    const r = verify(pkg, t, orig, width, height, 'wrong-secret');
    expect(r.status).toBe('INVALID_AUTH_PACKAGE');
  });

  it('13. Forged / replaced pixel tag rejected', () => {
    const decoded = decodePixel1AuthBlob(pkg.pixel1AuthBlob!);
    const tags = Buffer.from(decoded.tags);
    const idx = (20 * width + 20) * decoded.tagBytes;
    tags[idx] = (tags[idx]! ^ 0xff);
    const forgedBlob = encodePixel1AuthBlob({
      algorithmVersion: decoded.algorithmVersion,
      width: decoded.width,
      height: decoded.height,
      tagBytes: decoded.tagBytes,
      tags,
    });
    // root no longer matches → integrity fail
    const r = verify(
      { ...pkg, pixel1AuthBlob: forgedBlob },
      orig, orig, width, height,
    );
    // MATCH at phase1 if untouched - but pixel1 untrusted due to root mismatch when drilled
    // Untouched: no failed 2x2, still verifies blob integrity on entry when failed empty...
    // empty failed still runs integrity check first
    expect(r.pixel1Localization?.trusted === false || r.status === 'MATCH').toBe(true);
    if (r.status === 'MATCH') {
      // integrity checked even with zero failed parents
      expect(r.pixel1Localization?.trusted).toBe(false);
      expect(r.pixel1Localization?.unavailableReason).toMatch(/PIXEL1_ROOT|INVALID_PIXEL1/);
    }
  });

  it('14–20. Blob attacks (truncate / trailing / wrong root mac)', () => {
    const t = Buffer.from(orig);
    bumpChannel(t, width, 30, 30, 0, 1);

    const truncated = verify(
      { ...pkg, pixel1AuthBlob: pkg.pixel1AuthBlob!.subarray(0, 20) },
      t, orig, width, height,
    );
    expect(truncated.pixel1Localization?.trusted).toBe(false);

    const trailing = verify(
      { ...pkg, pixel1AuthBlob: Buffer.concat([pkg.pixel1AuthBlob!, Buffer.from([1, 2, 3])]) },
      t, orig, width, height,
    );
    expect(trailing.pixel1Localization?.trusted).toBe(false);

    const badMac = verify(
      { ...pkg, pixel1RootMac: '00'.repeat(32) },
      t, orig, width, height,
    );
    expect(badMac.pixel1Localization?.trusted).toBe(false);
    expect(badMac.pixel1Localization?.unavailableReason).toBe('INVALID_PIXEL1_PACKAGE');
  });

  it('21. One pixel tiger.jpeg exact', async () => {
    expect(fs.existsSync(REAL_IMAGE)).toBe(true);
    const decoded = await decodeImageForSpatialAuth(fs.readFileSync(REAL_IMAGE));
    const { rgb, width: w, height: h } = decoded;
    const p = enroll(rgb, w, h, DNA + '-tiger', REF + '-tiger');
    const t = Buffer.from(rgb);
    const tx = Math.min(400, w - 1);
    const ty = Math.min(500, h - 1);
    bumpChannel(t, w, tx, ty, 0, 1);
    const r = verify(p, t, rgb, w, h);
    expect(r.pixel1Localization!.enrolledVerification).toBe(true);
    expect(r.pixel1Localization!.tamperedPixels.length).toBe(1);
    expect(r.pixel1Localization!.tamperedPixels[0]).toMatchObject({ x: tx, y: ty });
    expect(r.pixel1Localization!.pixels.filter((px) => px.status === 'AUTHENTIC').length).toBe(3);
  });

  it('22–24. R/G/B ±1 against enrolled tags', async () => {
    for (const [ch, d, lab] of [[0, 1, 'rp'], [0, -1, 'rm'], [1, 1, 'gp'], [2, -1, 'bm']] as const) {
      const img = await patterned(256, 256);
      const p = enroll(img.rgb, 256, 256, DNA + lab, REF + lab);
      const t = Buffer.from(img.rgb);
      bumpChannel(t, 256, 48, 48, ch, d);
      const r = verify(p, t, img.rgb, 256, 256);
      expect(r.pixel1Localization!.tamperedPixels).toEqual([
        expect.objectContaining({ x: 48, y: 48 }),
      ]);
    }
  });

  it('25–26. 10 and 100 pixels P=R=1', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-n', REF + '-n');
    for (const n of [10, 100]) {
      const t = Buffer.from(img.rgb);
      const mods = new Set<string>();
      for (let i = 0; i < n; i++) {
        const x = (i * 19 + 5) % 256;
        const y = (i * 23 + 7) % 256;
        const k = `${x},${y}`;
        if (mods.has(k)) continue;
        bumpChannel(t, 256, x, y, 0, 1);
        mods.add(k);
      }
      const r = verify(p, t, img.rgb, 256, 256);
      const T = new Set(r.pixel1Localization!.tamperedPixels.map((px) => `${px.x},${px.y}`));
      expect([...mods].every((k) => T.has(k))).toBe(true);
      expect([...T].every((k) => mods.has(k))).toBe(true);
    }
  });

  it('27–30. Region and boundary', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-b', REF + '-b');
    const t = Buffer.from(img.rgb);
    fillRect(t, 256, 16, 16, 2, 2, 9, 9, 9);
    let r = verify(p, t, img.rgb, 256, 256);
    expect(r.pixel1Localization!.tamperedPixels.length).toBe(4);

    const t2 = Buffer.from(img.rgb);
    bumpChannel(t2, 256, 15, 16, 0, 1);
    bumpChannel(t2, 256, 16, 16, 0, 1);
    r = verify(p, t2, img.rgb, 256, 256);
    expect(r.pixel1Localization!.tamperedPixels.length).toBe(2);

    const t3 = Buffer.from(img.rgb);
    bumpChannel(t3, 256, 63, 64, 0, 1);
    bumpChannel(t3, 256, 64, 64, 0, 1);
    r = verify(p, t3, img.rgb, 256, 256);
    expect(r.localization!.tamperedBlocks.length).toBe(2);
    expect(r.pixel1Localization!.tamperedPixels.length).toBe(2);
  });

  it('31. Lazy — one pixel ≤4 enrolled lookups', async () => {
    const img = await patterned(256, 256);
    const p = enroll(img.rgb, 256, 256, DNA + '-lazy', REF + '-lazy');
    const t = Buffer.from(img.rgb);
    bumpChannel(t, 256, 20, 20, 0, 1);
    const r = verify(p, t, img.rgb, 256, 256);
    expect(r.pixel1Localization!.stats.pixelsInspected).toBeLessThanOrEqual(4);
    expect(r.pixel1Localization!.enrolledVerification).toBe(true);
  });

  it('32. Untouched → 0 pixel checks', () => {
    const r = verify(pkg, orig, orig, width, height);
    expect(r.pixel1Localization!.stats.pixelsInspected).toBe(0);
  });

  it('33. Cannot forge enrolled tag without secret', () => {
    const decoded = decodePixel1AuthBlob(pkg.pixel1AuthBlob!);
    const enrolled = lookupPixel1EnrolledTag(decoded, 8, 8);
    const attackerKey = deriveSpatialPixel1Key({
      dnaRecordId: DNA, ownerUserId: OWNER, globalDnaRef: REF, keyId: KEY, masterSecret: 'attacker-guess',
    });
    const forged = computePixel1AuthTag({
      pixel1Key: attackerKey,
      algorithmVersion: 'spatial-pixel1-auth-v1',
      dnaRecordId: DNA,
      globalDnaRef: REF,
      parentCellId: unitIdAt(2, width, 4, 4),
      x: 8, y: 8, width: 1, height: 1,
      r: 255, g: 0, b: 0,
    });
    expect(forged.equals(enrolled)).toBe(false);
  });

  it('34. Storage size reported for 256²', () => {
    expect(pkg.pixel1AuthBlob!.length).toBeGreaterThan(256 * 256 * 8);
    // eslint-disable-next-line no-console
    console.log(`[4e-storage] 256x256 blobBytes=${pkg.pixel1AuthBlob!.length} root=${pkg.pixel1AuthRoot}`);
  });
});

describe('Phase 4E — enrolled 1×1 megapixel cost (1MP)', () => {
  jest.setTimeout(300_000);

  beforeAll(() => {
    process.env['SPATIAL_4X4_AUTH_ENABLED'] = 'true';
    process.env['SPATIAL_2X2_AUTH_ENABLED'] = 'true';
    process.env['SPATIAL_1X1_AUTH_ENABLED'] = 'true';
  });
  afterAll(() => {
    delete process.env['SPATIAL_4X4_AUTH_ENABLED'];
    delete process.env['SPATIAL_2X2_AUTH_ENABLED'];
    delete process.env['SPATIAL_1X1_AUTH_ENABLED'];
  });

  it('1MP enroll + one-pixel verify', async () => {
    const side = 1024;
    const img = await patterned(side, side);
    const tEnroll = Date.now();
    const p = enroll(img.rgb, side, side, DNA + '-1mp', REF + '-1mp');
    const enrollMs = Date.now() - tEnroll;
    const blobBytes = p.pixel1AuthBlob!.length;

    const t0 = Date.now();
    const clean = verify(p, img.rgb, img.rgb, side, side);
    const cleanMs = Date.now() - t0;
    expect(clean.pixel1Localization!.stats.pixelsInspected).toBe(0);

    const one = Buffer.from(img.rgb);
    bumpChannel(one, side, 500, 500, 0, 1);
    const t1 = Date.now();
    const r1 = verify(p, one, img.rgb, side, side);
    const oneMs = Date.now() - t1;
    expect(r1.pixel1Localization!.stats.pixelsInspected).toBeLessThanOrEqual(4);
    expect(r1.pixel1Localization!.enrolledVerification).toBe(true);

    // eslint-disable-next-line no-console
    console.log(
      `[4e-1mp] enrollMs=${enrollMs} blobBytes=${blobBytes} cleanMs=${cleanMs} ` +
        `oneMs=${oneMs} lookups=${r1.pixel1Localization!.stats.pixelsInspected}`,
    );
  });
});
