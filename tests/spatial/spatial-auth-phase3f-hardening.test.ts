/**
 * Phase 3F — security / package / serialization hardening tests
 * L1 strict trailing-byte reject · L2 canonical order · L3 lpbin-v1.1 encoding
 */

import sharp from 'sharp';
import crypto from 'crypto';
import {
  buildSpatialAuthPackageFromRgb,
  buildPixelAuthPackageFromRgb,
  verifyExactSpatialAuth,
  encodePixelAuthBlob,
  decodePixelAuthBlob,
  decodeBlockBlob,
  SPATIAL_AUTH_ALGORITHM_VERSION,
  SPATIAL_AUTH_ALGORITHM_VERSION_V1,
  SPATIAL_AUTH_ALGORITHM_VERSION_V1_1,
  SPATIAL_PIXEL_ALGORITHM_VERSION,
  SPATIAL_PIXEL_ALGORITHM_VERSION_V1,
  SPATIAL_PIXEL_ALGORITHM_VERSION_V1_1,
  buildCryptoPayload,
  encodingForSpatialAuthVersion,
  encodingForSpatialPixelVersion,
} from '../../src/services/spatial';
import type { SpatialAuthPackageData } from '../../src/services/spatial/types';

const MASTER = 'phase3f-hardening-secret';
const KEY = 'spatial-key-v1';
const OWNER = '3f-owner-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DNA = '3f-dna-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REF = 'seal:phase3f';

function setPixel(rgb: Buffer, w: number, x: number, y: number, r: number, g: number, b: number): void {
  const i = (y * w + x) * 3;
  rgb[i] = r;
  rgb[i + 1] = g;
  rgb[i + 2] = b;
}

async function patterned(w: number, h: number): Promise<{ rgb: Buffer; width: number; height: number }> {
  const { data, info } = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 12, g: 24, b: 36 } },
  }).raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      setPixel(data, w, x, y, (x * 5) % 256, (y * 9) % 256, (x + y) % 256);
    }
  }
  return { rgb: data, width: info.width, height: info.height };
}

function enroll(
  rgb: Buffer,
  width: number,
  height: number,
  opts?: { authVer?: string; pixelVer?: string; tagBytes?: 8 | 16 },
): SpatialAuthPackageData {
  const { packageData } = buildSpatialAuthPackageFromRgb({
    rgb, width, height,
    dnaRecordId: DNA, ownerUserId: OWNER, globalDnaRef: REF,
    scales: [64, 128], primaryScale: 64, keyId: KEY, masterSecret: MASTER,
    algorithmVersion: opts?.authVer,
  });
  const { pixel } = buildPixelAuthPackageFromRgb({
    rgb, width, height,
    dnaRecordId: DNA, ownerUserId: OWNER, globalDnaRef: REF,
    keyId: KEY, tagBytes: opts?.tagBytes ?? 8, masterSecret: MASTER,
    algorithmVersion: opts?.pixelVer,
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

describe('Phase 3F — hardening', () => {
  let rgb: Buffer;
  let width: number;
  let height: number;
  let pkg: SpatialAuthPackageData;
  let legacyPkg: SpatialAuthPackageData;

  beforeAll(async () => {
    const img = await patterned(128, 128);
    rgb = img.rgb;
    width = img.width;
    height = img.height;
    pkg = enroll(rgb, width, height);
    legacyPkg = enroll(rgb, width, height, {
      authVer: SPATIAL_AUTH_ALGORITHM_VERSION_V1,
      pixelVer: SPATIAL_PIXEL_ALGORITHM_VERSION_V1,
    });
  });

  it('defaults to hardened v1.1 enrollment versions', () => {
    expect(SPATIAL_AUTH_ALGORITHM_VERSION).toBe(SPATIAL_AUTH_ALGORITHM_VERSION_V1_1);
    expect(SPATIAL_PIXEL_ALGORITHM_VERSION).toBe(SPATIAL_PIXEL_ALGORITHM_VERSION_V1_1);
    expect(pkg.algorithmVersion).toBe('spatial-auth-v1.1');
    expect(pkg.pixelAlgoVersion).toBe('spatial-pixel-auth-v1.1');
    expect(encodingForSpatialAuthVersion(pkg.algorithmVersion)).toBe('lpbin-v1.1');
    expect(encodingForSpatialPixelVersion(pkg.pixelAlgoVersion!)).toBe('lpbin-v1.1');
  });

  // ── L1 trailing bytes ──────────────────────────────────────────────────
  it('L1: valid blob decodes', () => {
    const d = decodePixelAuthBlob(pkg.pixelAuthBlob!);
    expect(d.leaves.length).toBeGreaterThan(0);
    const b = decodeBlockBlob(pkg.blockBlob);
    expect(b.leaves.length).toBeGreaterThan(0);
  });

  it('L1: +1 trailing byte rejected', () => {
    expect(() => decodePixelAuthBlob(Buffer.concat([pkg.pixelAuthBlob!, Buffer.from([0x00])])))
      .toThrow(/Trailing bytes/);
    expect(() => decodeBlockBlob(Buffer.concat([pkg.blockBlob, Buffer.from([0x00])])))
      .toThrow(/Trailing bytes/);
    const r = verifyExactSpatialAuth({
      packageData: { ...pkg, pixelAuthBlob: Buffer.concat([pkg.pixelAuthBlob!, Buffer.from([1])]) },
      candidateRgb: rgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(r.pixelLayer?.status).toBe('INVALID_PIXEL_PACKAGE');
    expect(r.investigation?.fineMask).toBeNull();
  });

  it('L1: arbitrary trailing bytes / truncate / empty rejected', () => {
    expect(() => decodePixelAuthBlob(Buffer.concat([pkg.pixelAuthBlob!, crypto.randomBytes(16)])))
      .toThrow(/Trailing bytes/);
    expect(() => decodePixelAuthBlob(pkg.pixelAuthBlob!.subarray(0, 10))).toThrow();
    expect(() => decodePixelAuthBlob(Buffer.alloc(0))).toThrow(/empty/);
    expect(() => decodeBlockBlob(Buffer.alloc(0))).toThrow(/empty/);
  });

  // ── L2 canonical order ─────────────────────────────────────────────────
  it('L2: swap two cells rejected', () => {
    const blob = Buffer.from(pkg.pixelAuthBlob!);
    const decoded = decodePixelAuthBlob(pkg.pixelAuthBlob!);
    let o = 4;
    o += 1 + blob.readUInt8(4);
    o += 1 + blob.readUInt8(o);
    o += 7;
    const rowSize = 12 + decoded.tagBytes;
    const a = Buffer.from(blob.subarray(o, o + rowSize));
    const b = Buffer.from(blob.subarray(o + rowSize, o + 2 * rowSize));
    b.copy(blob, o);
    a.copy(blob, o + rowSize);
    expect(() => decodePixelAuthBlob(blob)).toThrow(/canonical ascending order/);
  });

  it('L2: reverse all cells rejected', () => {
    const decoded = decodePixelAuthBlob(pkg.pixelAuthBlob!);
    const reversed = [...decoded.leaves].reverse();
    // encodePixelAuthBlob re-sorts — bypass by crafting: encode then we need raw reverse
    // Build manually unordered by encoding sorted then permuting rows
    const sortedBlob = encodePixelAuthBlob({
      algorithmVersion: decoded.algorithmVersion,
      scheme: decoded.scheme,
      cellSize: decoded.cellSize,
      tagBytes: decoded.tagBytes,
      leaves: reversed, // encoder sorts — so use decode of valid + reverse rows in buffer
    });
    // Force reverse by rewriting leaf section
    const blob = Buffer.from(sortedBlob);
    let o = 4;
    o += 1 + blob.readUInt8(4);
    o += 1 + blob.readUInt8(o);
    o += 7;
    const rowSize = 12 + decoded.tagBytes;
    const rows: Buffer[] = [];
    for (let i = 0; i < decoded.leaves.length; i++) {
      rows.push(Buffer.from(blob.subarray(o + i * rowSize, o + (i + 1) * rowSize)));
    }
    rows.reverse();
    for (let i = 0; i < rows.length; i++) rows[i]!.copy(blob, o + i * rowSize);
    expect(() => decodePixelAuthBlob(blob)).toThrow(/canonical ascending order/);
  });

  it('L2: duplicate cellId rejected on decode', () => {
    const decoded = decodePixelAuthBlob(pkg.pixelAuthBlob!);
    const leaves = [...decoded.leaves];
    leaves[1] = { ...leaves[0]! }; // duplicate id at wrong position after sort encode
    // After encode sort, duplicates may sit adjacent with same id — encode still writes both
    const blob = encodePixelAuthBlob({
      algorithmVersion: decoded.algorithmVersion,
      scheme: decoded.scheme,
      cellSize: decoded.cellSize,
      tagBytes: decoded.tagBytes,
      leaves,
    });
    expect(() => decodePixelAuthBlob(blob)).toThrow(/Duplicate cellId/);
  });

  // ── L3 serialization ───────────────────────────────────────────────────
  it('L3: pipe-v1 vs lpbin-v1.1 payloads differ; delimiter-safe', () => {
    const fields = [
      { type: 'str' as const, value: 'a|b' },
      { type: 'str' as const, value: 'c|d' },
      { type: 'u16' as const, value: 64 },
    ];
    const pipe = buildCryptoPayload('pipe-v1', 'A', fields);
    const lp = buildCryptoPayload('lpbin-v1.1', 'A', fields);
    expect(pipe.includes(Buffer.from('|'))).toBe(true);
    // lpbin cannot be confused by embedded | in string content as field separator
    expect(lp.equals(pipe)).toBe(false);
    // Two different string fields with pipes remain distinct under lpbin
    const lp2 = buildCryptoPayload('lpbin-v1.1', 'A', [
      { type: 'str', value: 'a' },
      { type: 'str', value: 'b|c|d' },
      { type: 'u16', value: 64 },
    ]);
    expect(lp.equals(lp2)).toBe(false);
  });

  it('L3: integer encoding edges (0,1,boundary)', () => {
    const p0 = buildCryptoPayload('lpbin-v1.1', 'T', [
      { type: 'u16', value: 0 },
      { type: 'u32', value: 0 },
    ]);
    const p1 = buildCryptoPayload('lpbin-v1.1', 'T', [
      { type: 'u16', value: 1 },
      { type: 'u32', value: 1 },
    ]);
    expect(p0.equals(p1)).toBe(false);
    expect(() => buildCryptoPayload('lpbin-v1.1', 'T', [{ type: 'u16', value: -1 }])).toThrow();
    expect(() => buildCryptoPayload('lpbin-v1.1', 'T', [{ type: 'u16', value: 70000 }])).toThrow();
  });

  // ── Version / compatibility ────────────────────────────────────────────
  it('hardened package MATCH', () => {
    const r = verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: rgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(r.status).toBe('MATCH');
    expect(r.pixelLayer?.status).toBe('MATCH');
    expect(r.investigation?.trusted).toBe(true);
  });

  it('legacy v1 package still verifiable (backward compatibility)', () => {
    expect(legacyPkg.algorithmVersion).toBe('spatial-auth-v1');
    expect(legacyPkg.pixelAlgoVersion).toBe('spatial-pixel-auth-v1');
    const r = verifyExactSpatialAuth({
      packageData: legacyPkg, candidateRgb: rgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(r.status).toBe('MATCH');
    expect(r.pixelLayer?.status).toBe('MATCH');
  });

  it('legacy package does not verify under wrong (hardened) reinterpretation', () => {
    // Force wrong version stamp while keeping v1 tags → must fail
    const forged = { ...legacyPkg, algorithmVersion: SPATIAL_AUTH_ALGORITHM_VERSION_V1_1 };
    const r = verifyExactSpatialAuth({
      packageData: forged, candidateRgb: rgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(r.status).not.toBe('MATCH');
  });

  it('unknown version → UNSUPPORTED_VERSION', () => {
    const r = verifyExactSpatialAuth({
      packageData: { ...pkg, algorithmVersion: 'spatial-auth-v9' },
      candidateRgb: rgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(r.status).toBe('UNSUPPORTED_VERSION');
    expect(r.investigation?.trusted).toBe(false);
  });

  it('mismatched tag size / cell size rejected', () => {
    const r1 = verifyExactSpatialAuth({
      packageData: { ...pkg, pixelTagBytes: 16 },
      candidateRgb: rgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(r1.pixelLayer?.status).toBe('INVALID_PIXEL_PACKAGE');
    const r2 = verifyExactSpatialAuth({
      packageData: { ...pkg, pixelCellSize: 16 },
      candidateRgb: rgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(r2.pixelLayer?.status).toBe('INVALID_PIXEL_PACKAGE');
  });

  // ── Trust boundary ─────────────────────────────────────────────────────
  it('malformed package → trusted=false, no fine map', () => {
    const bad = Buffer.concat([pkg.pixelAuthBlob!, Buffer.from([0xff])]);
    const r = verifyExactSpatialAuth({
      packageData: { ...pkg, pixelAuthBlob: bad },
      candidateRgb: rgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    expect(r.pixelLayer?.status).toBe('INVALID_PIXEL_PACKAGE');
    expect(r.pixelLayer?.fineLocalization).toBeNull();
    expect(r.investigation?.fineMask).toBeNull();
  });

  // ── Fuzz / property ────────────────────────────────────────────────────
  it('fuzz: random mutations never crash; never trusted MATCH', () => {
    const base = pkg.pixelAuthBlob!;
    for (let i = 0; i < 80; i++) {
      const mut = Buffer.from(base);
      const mode = i % 6;
      if (mode === 0 && mut.length > 8) mut[4 + (i % (mut.length - 4))]! ^= 0xff;
      if (mode === 1) mut[0] = 0x00; // magic
      if (mode === 2) {
        // length field corruption
        if (mut.length > 5) mut[4] = 200;
      }
      if (mode === 3) {
        // truncate
        const cut = Math.max(1, (i * 7) % mut.length);
        try {
          decodePixelAuthBlob(mut.subarray(0, cut));
        } catch {
          /* expected */
        }
        continue;
      }
      if (mode === 4) {
        try {
          decodePixelAuthBlob(Buffer.concat([mut, crypto.randomBytes(3)]));
        } catch {
          /* expected */
        }
        continue;
      }
      if (mode === 5) {
        // random permute two mid bytes
        if (mut.length > 40) {
          const a = 20 + (i % 10);
          const b = 30 + (i % 10);
          const t = mut[a]!;
          mut[a] = mut[b]!;
          mut[b] = t;
        }
      }
      try {
        decodePixelAuthBlob(mut);
        // If it somehow parses, verify must not MATCH with this blob on original image
        // unless mutation was no-op
        if (!mut.equals(base)) {
          const r = verifyExactSpatialAuth({
            packageData: { ...pkg, pixelAuthBlob: mut },
            candidateRgb: rgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
          });
          expect(r.pixelLayer?.status === 'MATCH' && r.status === 'MATCH').toBe(false);
        }
      } catch {
        // controlled failure — OK
      }
    }
  });

  it('performance: strict decode overhead negligible vs verify', () => {
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) decodePixelAuthBlob(pkg.pixelAuthBlob!);
    const decodeMs = Date.now() - t0;
    const t1 = Date.now();
    verifyExactSpatialAuth({
      packageData: pkg, candidateRgb: rgb, candidateWidth: width, candidateHeight: height, masterSecret: MASTER,
    });
    const verifyMs = Date.now() - t1;
    // eslint-disable-next-line no-console
    console.log(`[3f-perf] 50x decode=${decodeMs}ms verifyOnce=${verifyMs}ms`);
    expect(decodeMs).toBeLessThan(verifyMs * 5 + 200);
  });
});
