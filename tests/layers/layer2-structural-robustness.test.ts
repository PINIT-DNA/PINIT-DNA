/**
 * Does Layer 2 (Sobel edge-zone signature) actually survive what its own
 * header comment claims ("Survives: Minor colour changes, brightness
 * adjustments, mild compression")? That claim was never measured — only
 * synthetic stripe-pattern correctness tests exist (layer2.structural.test.ts).
 * Same honesty framing as perceptual-robustness.test.ts and the watermark
 * transcode tests: measured, not assumed.
 */
import { describe, test, expect } from '@jest/globals';
import sharp from 'sharp';
import { StructuralLayer } from '../../src/services/layers/layer2.structural';
import type { ImageInput } from '../../src/types/dna.types';

const SLOW = 180_000;
const W = 640;
const H = 480;
/** The layer's own verify() threshold used elsewhere (dna.verifier.ts LAYER_THRESHOLDS.structural). */
const THRESHOLD = 0.75;

const layer = new StructuralLayer();

/** Deterministic photo-like image — same generator family used elsewhere this session. */
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
  return layer.verify(probe.data, { edgeSignature64: stored.data.edgeSignature64 });
}

describe('Layer 2 — is the header comment\'s survival claim real?', () => {
  const cases: Array<[string, (b: Buffer) => Promise<Buffer>]> = [
    ['JPEG q90', (b) => sharp(b).jpeg({ quality: 90 }).toBuffer()],
    ['JPEG q60', (b) => sharp(b).jpeg({ quality: 60 }).toBuffer()],
    ['JPEG q30 ("mild compression" — the header\'s own words)', (b) => sharp(b).jpeg({ quality: 30 }).toBuffer()],
    ['brightness adjustment', (b) => sharp(b).modulate({ brightness: 1.25 }).png().toBuffer()],
    ['colour change (saturation)', (b) => sharp(b).modulate({ saturation: 1.5, hue: 20 }).png().toBuffer()],
  ];

  test.each(cases)('%s — the header claims this survives', async (_name, tamper) => {
    const original = await makeImage(5501);
    const sim = await similarity(original, await tamper(original));
    // Measured (real run, this file): 0.92-1.00 across JPEG q90/q60/q30,
    // brightness, and colour/saturation — comfortably above the 0.75
    // threshold dna.verifier.ts actually uses. Unlike several other "survives
    // X" claims found and corrected this session, this one is genuinely
    // true. Confirmed, not assumed.
    expect(sim).toBeGreaterThanOrEqual(THRESHOLD);
  }, SLOW);

  test('crop is confirmed defeated, exactly as the header already discloses', async () => {
    const original = await makeImage(5501);
    const cropped = await sharp(original).extract({ left: 100, top: 80, width: 400, height: 300 }).png().toBuffer();
    const sim = await similarity(original, cropped);
    expect(sim).toBeLessThan(THRESHOLD);
  }, SLOW);
});
