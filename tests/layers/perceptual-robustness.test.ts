/**
 * What the perceptual layer can and cannot recognise.
 *
 * Measured on a generated photo-like image, not asserted from the design. Three
 * groups:
 *
 *  A. PROMISED   — tampering a leaker really does (recompress, resize, screenshot,
 *                  recolour). The hash must still match.
 *  B. ORIENTATION— a mirrored or turned copy. Recognised through orientation
 *                  variants, and an unrelated image must NOT be recognised that way.
 *  C. LIMITS     — tampering the hash does not survive (crop, free rotation), and
 *                  the hidden pixel mark that does not survive recompression.
 *                  These are pinned so nobody documents them as protected: if one
 *                  starts passing, this fails and the claim can be widened on purpose.
 *
 * Only PerceptualLayer is used. Layer 2 writes a carrier file to disk.
 */
import { describe, test, expect } from '@jest/globals';
import sharp from 'sharp';
import { PerceptualLayer } from '../../src/services/layers/layer3.perceptual';
import { TURNED_ORIENTATIONS, shrinkForOrientationProbe, turnImage } from '../../src/services/duplicate/orientation-variants';
import { embedOwnershipWatermark, extractOwnershipWatermark } from '../../src/services/layers/ownership-watermark';

const SLOW = 180_000;
const W = 1200;
const H = 800;
/** The upload duplicate check's own threshold. */
const THRESHOLD = 0.9;

const layer = new PerceptualLayer();

/** Deterministic photo-like image: smooth colour field, shapes and sensor noise. */
async function makeImage(seed: number): Promise<Buffer> {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const raw = Buffer.alloc(W * H * 3);
  const fx = 60 + rnd() * 80, fy = 50 + rnd() * 60;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const v = 128 + 90 * Math.sin(x / fx) * Math.cos(y / fy);
      raw[i] = Math.max(0, Math.min(255, v + 40 * Math.sin(x / 200) + (rnd() - 0.5) * 14));
      raw[i + 1] = Math.max(0, Math.min(255, v * 0.8 + 50 * Math.cos(y / 130) + (rnd() - 0.5) * 14));
      raw[i + 2] = Math.max(0, Math.min(255, 255 - v + 30 * Math.sin((x + y) / 160) + (rnd() - 0.5) * 14));
    }
  }
  const shapes = Array.from({ length: 40 }, () =>
    `<circle cx="${(rnd() * W) | 0}" cy="${(rnd() * H) | 0}" r="${20 + rnd() * 90}" ` +
    `fill="rgb(${(rnd() * 255) | 0},${(rnd() * 255) | 0},${(rnd() * 255) | 0})" fill-opacity="0.55"/>`).join('');
  const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`);
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: svg }]).png().toBuffer();
}

async function similarity(original: Buffer, candidate: Buffer): Promise<number> {
  const stored = await layer.computeFingerprints(original);
  const probe = await layer.computeFingerprints(candidate);
  return layer.verify(probe, { pHash64: stored.pHash64, aHash64: stored.aHash64, dHash64: stored.dHash64 });
}

/** Best similarity over the file as uploaded AND its 7 other orientations. */
async function bestAcrossOrientations(original: Buffer, candidate: Buffer): Promise<number> {
  const stored = await layer.computeFingerprints(original);
  const against = async (b: Buffer) => {
    const probe = await layer.computeFingerprints(b);
    return layer.verify(probe, { pHash64: stored.pHash64, aHash64: stored.aHash64, dHash64: stored.dHash64 });
  };
  let best = await against(candidate);
  // the same shrink-then-turn path the upload check takes
  const small = await shrinkForOrientationProbe(candidate);
  for (const o of TURNED_ORIENTATIONS) best = Math.max(best, await against(await turnImage(small, o)));
  return best;
}

describe('A. tampering the perceptual layer is promised to survive', () => {
  const cases: Array<[string, (b: Buffer) => Promise<Buffer>]> = [
    ['JPEG q90', (b) => sharp(b).jpeg({ quality: 90 }).toBuffer()],
    ['JPEG q60', (b) => sharp(b).jpeg({ quality: 60 }).toBuffer()],
    ['JPEG q30', (b) => sharp(b).jpeg({ quality: 30 }).toBuffer()],
    ['resize to 50%', (b) => sharp(b).resize(W / 2).png().toBuffer()],
    ['shrink to 25% and enlarge again', async (b) => sharp(await sharp(b).resize(W / 4).toBuffer()).resize(W).png().toBuffer()],
    ['brightness and contrast change', (b) => sharp(b).modulate({ brightness: 1.25 }).linear(1.15, -10).png().toBuffer()],
    ['grayscale', (b) => sharp(b).grayscale().png().toBuffer()],
    ['screenshot: 80% scale, blur, JPEG q75', async (b) => sharp(await sharp(b).resize(Math.round(W * 0.8)).blur(0.8).toBuffer()).jpeg({ quality: 75 }).toBuffer()],
  ];

  test.each(cases)('%s is still recognised', async (_name, tamper) => {
    const original = await makeImage(12345);
    const sim = await similarity(original, await tamper(original));
    expect(sim).toBeGreaterThanOrEqual(THRESHOLD);
  }, SLOW);
});

describe('B. a mirrored or turned copy', () => {
  const turns: Array<[string, (b: Buffer) => Promise<Buffer>]> = [
    ['mirrored', (b) => sharp(b).flop().png().toBuffer()],
    ['mirrored top to bottom', (b) => sharp(b).flip().png().toBuffer()],
    ['rotated 90 degrees', (b) => sharp(b).rotate(90).png().toBuffer()],
    ['rotated 180 degrees', (b) => sharp(b).rotate(180).png().toBuffer()],
    ['rotated 270 degrees', (b) => sharp(b).rotate(270).png().toBuffer()],
    ['mirrored then re-saved as JPEG q60', async (b) => sharp(await sharp(b).flop().toBuffer()).jpeg({ quality: 60 }).toBuffer()],
  ];

  test('on its own the hash does NOT recognise a mirrored copy (the gap)', async () => {
    const original = await makeImage(12345);
    expect(await similarity(original, await sharp(original).flop().png().toBuffer())).toBeLessThan(THRESHOLD);
  }, SLOW);

  test.each(turns)('%s is recognised through orientation variants', async (_name, turn) => {
    const original = await makeImage(12345);
    expect(await bestAcrossOrientations(original, await turn(original))).toBeGreaterThanOrEqual(THRESHOLD);
  }, SLOW);

  test('an unrelated image is NOT matched by turning it', async () => {
    // The guard against the fix over-matching: eight orientations is eight chances
    // to collide, so different images must still stay below the threshold in all of them.
    const original = await makeImage(12345);
    let worst = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      worst = Math.max(worst, await bestAcrossOrientations(original, await makeImage(seed * 7919)));
    }
    expect(worst).toBeLessThan(THRESHOLD);
  }, SLOW);
});

describe('C. limits — not promised, pinned so they are not overclaimed', () => {
  test('a 40% crop is not recognised by the whole-image hash', async () => {
    const original = await makeImage(12345);
    const cropped = await sharp(original).extract({ left: 300, top: 200, width: 480, height: 320 }).png().toBuffer();
    expect(await bestAcrossOrientations(original, cropped)).toBeLessThan(THRESHOLD);
  }, SLOW);

  test('a 5 degree rotation is not recognised (free rotation resamples the pixels)', async () => {
    const original = await makeImage(12345);
    const rotated = await sharp(original).rotate(5, { background: '#000' }).png().toBuffer();
    expect(await bestAcrossOrientations(original, rotated)).toBeLessThan(THRESHOLD);
  }, SLOW);

  test('the hidden ownership mark survives a lossless copy but NOT JPEG recompression', async () => {
    const original = await makeImage(12345);
    const { data, info } = await sharp(original).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const marked = embedOwnershipWatermark(data, info.width, info.height, { dnaRecordId: 'dna-test', ownerUserId: 'owner-1', vaultId: 'v1', filename: 'x.png' });
    const png = await sharp(marked.rgb, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
    const jpg = await sharp(png).jpeg({ quality: 90 }).toBuffer();

    const recovered = async (b: Buffer): Promise<boolean> => {
      const r = await sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const out = extractOwnershipWatermark(r.data, r.info.width, r.info.height) as unknown as Record<string, unknown>;
      return Boolean(out && (out['valid'] || out['found'] || out['recovered'] || out['ownerUserId'] || out['dnaRecordId']));
    };

    expect(await recovered(png)).toBe(true);
    expect(await recovered(jpg)).toBe(false);
  }, SLOW);
});
