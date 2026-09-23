/**
 * Does Layer 4 (RGB/HSV histogram) actually survive what its own header
 * comment claims ("Survives: Pixel-level noise, minor colour shifts, format
 * conversion, light JPEG compression")? Never measured before — only a
 * synthetic solid-colour test and one +10% brightness case exist
 * (layer4.semantic.test.ts). Measured, not assumed.
 */
import { describe, test, expect } from '@jest/globals';
import sharp from 'sharp';
import { SemanticLayer } from '../../src/services/layers/layer4.semantic';
import type { ImageInput } from '../../src/types/dna.types';

const SLOW = 180_000;
const W = 640;
const H = 480;
/** dna.verifier.ts LAYER_THRESHOLDS.semantic */
const THRESHOLD = 0.70;

const layer = new SemanticLayer();

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

function asImageInput(buffer: Buffer, mimeType = 'image/png'): ImageInput {
  return { filePath: '', originalName: 'probe', mimeType, sizeBytes: buffer.length, buffer };
}

async function similarity(original: Buffer, candidate: Buffer): Promise<number> {
  const stored = await layer.generate(asImageInput(original));
  const probe = await layer.generate(asImageInput(candidate));
  return layer.verify(probe.data, {
    histogramR: stored.data.histogramR,
    histogramG: stored.data.histogramG,
    histogramB: stored.data.histogramB,
    colorFingerprint: stored.data.colorFingerprint,
  });
}

describe('Layer 4 — is the header comment\'s survival claim real?', () => {
  const survives: Array<[string, (b: Buffer) => Promise<Buffer>]> = [
    ['pixel-level noise', (b) => sharp(b).blur(0.3).png().toBuffer()],
    ['minor colour shift', (b) => sharp(b).modulate({ hue: 10, saturation: 1.05 }).png().toBuffer()],
    ['format conversion (PNG -> JPEG q95)', (b) => sharp(b).jpeg({ quality: 95 }).toBuffer()],
    ['light JPEG compression (q85)', (b) => sharp(b).jpeg({ quality: 85 }).toBuffer()],
  ];

  test.each(survives)('%s — the header claims this survives', async (_name, tamper) => {
    const original = await makeImage(7701);
    const sim = await similarity(original, await tamper(original));
    expect(sim).toBeGreaterThanOrEqual(THRESHOLD);
  }, SLOW);

  test('resize (not in the header\'s claim list — measured anyway, since colour histograms are spatially invariant)', async () => {
    const original = await makeImage(7701);
    const resized = await sharp(original).resize(Math.round(W / 2)).png().toBuffer();
    const sim = await similarity(original, resized);
    expect(sim).toBeGreaterThanOrEqual(THRESHOLD);
  }, SLOW);

  test('a radical colour inversion is NOT reliably defeated — the header is wrong', async () => {
    // Real bug found writing this test: the header claims inversion is
    // defeated. Measured: 0.79 similarity — ABOVE the 0.70 threshold this
    // layer is actually gated on. An inverted copy would read as a match.
    // Pinned to the real result, not the header's claim.
    const original = await makeImage(7701);
    const inverted = await sharp(original).negate().png().toBuffer();
    const sim = await similarity(original, inverted);
    expect(sim).toBeGreaterThanOrEqual(THRESHOLD);
  }, SLOW);

  test('two completely unrelated images score ABOVE threshold — a real false-positive risk', async () => {
    // More serious than the inversion case: two different synthetic photos
    // (different seeds, no relationship) score 0.84 — comfortably above the
    // 0.70 gate. Coarse 8-bin colour histograms alone don't discriminate
    // content well. Layer 4 is weight 0.12 in the fused CORE_WEIGHTS score
    // (weighted-dna-scoring.service.ts) and is NOT used as a standalone gate
    // anywhere in duplicate-check.service.ts, so this doesn't block real
    // uploads today — but it does mean Layer 4's own vote in a fused score
    // can't be trusted to mean "same image," and its threshold should not be
    // used alone anywhere in the future without this limitation in mind.
    const original = await makeImage(7701);
    const different = await makeImage(9902);
    const sim = await similarity(original, different);
    expect(sim).toBeGreaterThanOrEqual(THRESHOLD);
  }, SLOW);
});
