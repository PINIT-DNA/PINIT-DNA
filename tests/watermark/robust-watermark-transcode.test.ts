/**
 * Does the robust provenance watermark actually survive recompression?
 *
 * Measured against real transforms, not assumed. Same honesty framing as
 * tests/layers/perceptual-robustness.test.ts:
 *
 *  A. PROMISED — what a leaker really does (recompress, resize, screenshot).
 *     The lookup ID embedded by embedRobustProvenanceWatermark must still
 *     decode.
 *  C. LIMITS   — the older, non-redundant phase3 DCT watermark, run through
 *     the same matrix, pinned to its real measured behaviour rather than an
 *     assumption. Nobody should read "DCT watermark" in this codebase and
 *     assume it means what image-dct-watermark.ts actually does.
 *
 * History: the first version of this file measured the ORIGINAL
 * embedRobustProvenanceWatermark implementation (single Haar mid-band
 * coefficient per tile, delta=8) and found it survived brightness/grayscale
 * but failed every JPEG recompression, even q90, and never survived resize
 * at any delta up to 250 (visually destructive). The implementation was
 * replaced with a half-tile mean-luma ("Patchwork") scheme — see
 * src/services/dna-vnext/robust-watermark.ts's header comment for why that
 * survives JPEG at a far smaller, genuinely invisible delta. Resize was
 * still not solved at that point (structural tile-grid addressing problem,
 * not a magnitude one).
 *
 * 2026-09-23: resize tolerance fixed by moving tile addressing into a
 * resolution-independent canonical frame (canonicalDims in
 * robust-watermark.ts) instead of native pixels. Measured below across a
 * real resize matrix at multiple resolutions — uniform, aspect-ratio-
 * preserving resize now survives; non-uniform stretch and crop remain out
 * of scope (ORB's job elsewhere in the system).
 */
import { describe, test, expect } from '@jest/globals';
import sharp from 'sharp';
import {
  embedRobustProvenanceWatermark,
  extractWatermarkLookupId,
} from '../../src/services/dna-vnext/robust-watermark';
import { watermarkLookupId } from '../../src/services/dna-vnext/crypto';
import {
  embedImageDctWatermark,
  extractImageDctWatermark,
} from '../../src/services/watermark/phase3/image-dct-watermark';

const SLOW = 180_000;
const VAULT_ID = 'vault-transcode-test';
const DNA_RECORD_ID = 'dna-transcode-test';

/** Deterministic photo-like image — same generator as perceptual-robustness.test.ts. */
async function makeImage(seed: number, width: number, height: number): Promise<Buffer> {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const raw = Buffer.alloc(width * height * 3);
  const fx = 60 + rnd() * 80, fy = 50 + rnd() * 60;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const v = 128 + 90 * Math.sin(x / fx) * Math.cos(y / fy);
      raw[i] = Math.max(0, Math.min(255, v + 40 * Math.sin(x / 200) + (rnd() - 0.5) * 14));
      raw[i + 1] = Math.max(0, Math.min(255, v * 0.8 + 50 * Math.cos(y / 130) + (rnd() - 0.5) * 14));
      raw[i + 2] = Math.max(0, Math.min(255, 255 - v + 30 * Math.sin((x + y) / 160) + (rnd() - 0.5) * 14));
    }
  }
  const shapes = Array.from({ length: 40 }, () =>
    `<circle cx="${(rnd() * width) | 0}" cy="${(rnd() * height) | 0}" r="${20 + rnd() * 90}" ` +
    `fill="rgb(${(rnd() * 255) | 0},${(rnd() * 255) | 0},${(rnd() * 255) | 0})" fill-opacity="0.55"/>`).join('');
  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`);
  return sharp(raw, { raw: { width, height, channels: 3 } }).composite([{ input: svg }]).png().toBuffer();
}

function transforms(width: number): Array<[string, (b: Buffer) => Promise<Buffer>]> {
  return [
    ['JPEG q90', (b) => sharp(b).jpeg({ quality: 90 }).toBuffer()],
    ['JPEG q60', (b) => sharp(b).jpeg({ quality: 60 }).toBuffer()],
    ['JPEG q30', (b) => sharp(b).jpeg({ quality: 30 }).toBuffer()],
    ['JPEG q10', (b) => sharp(b).jpeg({ quality: 10 }).toBuffer()],
    ['resize to 50%', (b) => sharp(b).resize(Math.round(width / 2)).png().toBuffer()],
    ['resize to 75%', (b) => sharp(b).resize(Math.round(width * 0.75)).png().toBuffer()],
    ['resize to 25%', (b) => sharp(b).resize(Math.round(width * 0.25)).png().toBuffer()],
    ['resize to 150% (upsize)', (b) => sharp(b).resize(Math.round(width * 1.5)).png().toBuffer()],
    ['brightness and contrast change', (b) => sharp(b).modulate({ brightness: 1.25 }).linear(1.15, -10).png().toBuffer()],
    ['grayscale', (b) => sharp(b).grayscale().png().toBuffer()],
    ['screenshot: 80% scale, blur, JPEG q75', async (b) => sharp(await sharp(b).resize(Math.round(width * 0.8)).blur(0.8).toBuffer()).jpeg({ quality: 75 }).toBuffer()],
  ];
}

describe('A. the robust watermark (half-tile Patchwork scheme) — measured, not assumed', () => {
  // Large enough that the 720-bit (30-byte x8 x3-redundancy) payload gets
  // several full copies at 1 bit/16x16-tile capacity (960x800 -> 60x50=3000
  // tiles -> 4 copies) — the earlier 480x320 test image was sized for the
  // OLD 4-bits/tile scheme and is too small for this one's real capacity.
  const W = 960;
  const H = 800;
  let watermarked: Buffer;
  const expectedLookup = watermarkLookupId(VAULT_ID, DNA_RECORD_ID);

  beforeAll(async () => {
    const original = await makeImage(9001, W, H);
    // mimeType 'image/png' so the function's OWN internal save (embed then
    // sharp .toFormat(...)) is lossless — isolates whether the algorithm
    // itself is sound from what any LATER transform below does to it.
    const result = await embedRobustProvenanceWatermark({
      buffer: original,
      mimeType: 'image/png',
      vaultId: VAULT_ID,
      dnaRecordId: DNA_RECORD_ID,
    });
    expect(result.embedded).toBe(true);
    watermarked = result.buffer;
    // Sanity: extraction works on the freshly-embedded file itself, before any tamper.
    expect(await extractWatermarkLookupId(watermarked)).toBe(expectedLookup);
  }, SLOW);

  // Measured (real run, this file): survives every JPEG recompression level
  // tested down to q10, brightness/contrast, grayscale, and — since the
  // canonical-frame fix — uniform resize at every tested factor (150%
  // upsize down to 25%) including the composite screenshot transform. Empty
  // set kept (not deleted) so a future regression shows up as an explicit
  // failure here rather than silently passing an assertion that no longer
  // exists.
  const DOES_NOT_SURVIVE = new Set<string>([]);

  test.each(transforms(W))('%s', async (name, tamper) => {
    const tampered = await tamper(watermarked);
    const decoded = await extractWatermarkLookupId(tampered);
    if (DOES_NOT_SURVIVE.has(name)) {
      // Pinned to the real measured failure, not asserted — if this starts
      // passing (e.g. a future scale-search fix), move it out of this set.
      expect(decoded).toBeNull();
    } else {
      expect(decoded).toBe(expectedLookup);
    }
  }, SLOW);
});

describe('A1. resize tolerance at a native resolution ABOVE canonical (2000x1500 > 1600 canonical long side)', () => {
  // The 960x800 image above is smaller than CANONICAL_LONG_SIDE (1600), so
  // every embed-time proportional rectangle is smaller than a canonical
  // 16x16 tile (scale factor < 1). This resolution is larger, so rectangles
  // are bigger than a tile (scale factor > 1) — a different code path in
  // embedBitsInRgba's scaleX/scaleY mapping, verified separately rather
  // than assumed to behave the same as the downscale case.
  const W = 2000;
  const H = 1500;
  const expectedLookup = watermarkLookupId(VAULT_ID, DNA_RECORD_ID);
  let watermarked: Buffer;

  beforeAll(async () => {
    const original = await makeImage(9003, W, H);
    const result = await embedRobustProvenanceWatermark({
      buffer: original, mimeType: 'image/png', vaultId: VAULT_ID, dnaRecordId: DNA_RECORD_ID,
    });
    expect(result.embedded).toBe(true);
    watermarked = result.buffer;
  }, SLOW);

  test.each(transforms(W))('%s', async (_name, tamper) => {
    const tampered = await tamper(watermarked);
    const decoded = await extractWatermarkLookupId(tampered);
    expect(decoded).toBe(expectedLookup);
  }, SLOW);
});

describe('A2. embedding directly as JPEG (the function\'s own lossy save)', () => {
  test('the embed step itself — does the mark survive its own first save as JPEG?', async () => {
    // embedRobustProvenanceWatermark(mimeType: 'image/jpeg') re-encodes its
    // OWN output as JPEG at sharp's default quality as part of embedding —
    // not a later transform, the embed call itself. Measured, not assumed.
    const W = 960, H = 800;
    const original = await makeImage(9001, W, H);
    const result = await embedRobustProvenanceWatermark({
      buffer: original,
      mimeType: 'image/jpeg',
      vaultId: VAULT_ID,
      dnaRecordId: DNA_RECORD_ID,
    });
    expect(result.embedded).toBe(true);
    const decoded = await extractWatermarkLookupId(result.buffer);
    expect(decoded).toBe(watermarkLookupId(VAULT_ID, DNA_RECORD_ID));
  }, SLOW);
});

describe('C. limits — the older phase3 DCT watermark, pinned to what it actually does', () => {
  const W = 480;
  const H = 320;
  const PAYLOAD = 'owner-fingerprint-1234567890';

  async function embedDct(buffer: Buffer): Promise<Buffer> {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const marked = embedImageDctWatermark(data, info.width, info.height, PAYLOAD);
    return sharp(marked, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  }

  async function extractDct(buffer: Buffer): Promise<string | null> {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return extractImageDctWatermark(data, info.width, info.height);
  }

  let marked: Buffer;

  beforeAll(async () => {
    const original = await makeImage(9002, W, H);
    marked = await embedDct(original);
  }, SLOW);

  test('does NOT reliably survive even a lossless re-encode — a real encoding bug, not just fragility', async () => {
    // Real bug found while writing this test, independent of any recompression:
    // embedImageDctWatermark encodes bit=0 as `abs(originalCoeff) - 12` (a
    // RELATIVE reduction from whatever the block's original coefficient was),
    // but extractImageDctWatermark decodes by `abs(coeff) > 8 ? 1 : 0` (an
    // ABSOLUTE magnitude threshold). For any block whose original coefficient
    // magnitude exceeds ~20, encoding bit=0 leaves abs(coeff) still > 8, which
    // decodes back as 1 — silently flipping the bit on a pure lossless
    // round-trip, no compression involved. Pinned to the real measured
    // outcome rather than assumed to work. Not fixed here — out of scope,
    // this engine isn't used for anything production reads back today.
    expect(await extractDct(marked)).toBeNull();
  }, SLOW);

  test.each(transforms(W))('%s — pinned result (not asserted to survive)', async (_name, tamper) => {
    const tampered = await tamper(marked);
    const recovered = await extractDct(tampered);
    expect(recovered).toBeNull();
  }, SLOW);
});

describe('known gap — the vault-side DWT watermark has no extractor at all', () => {
  test('embedImageDwtWatermark exists but extractImageDwtWatermark does not', () => {
    // src/services/watermark/vault/image-dwt-watermark.ts is write-only:
    // whatever it embeds can never be read back by any code in this repo.
    // Not fixed here — just documented so nobody builds on it assuming
    // recovery is possible.
    const mod = require('../../src/services/watermark/vault/image-dwt-watermark');
    expect(typeof mod.embedImageDwtWatermark).toBe('function');
    expect(mod.extractImageDwtWatermark).toBeUndefined();
  });
});
