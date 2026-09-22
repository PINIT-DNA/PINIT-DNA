/**
 * The single-decode patch extractor must produce EXACTLY the patch bytes (and therefore
 * fingerprints) of the per-patch `sharp(buffer).extract().toBuffer()` path — stored
 * vault fingerprints were built with that path, so any difference would move scores.
 */
import { describe, test, expect } from '@jest/globals';
import sharp from 'sharp';
import { createPatchExtractor } from '../../src/services/forensics/local-dna-patch-generator.service';

const W = 640;
const H = 480;

async function photo(): Promise<Buffer> {
  let s = 7;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const v = 128 + 90 * Math.sin(x / 37) * Math.cos(y / 29);
    raw[i] = v + (rnd() - 0.5) * 30; raw[i + 1] = v * 0.8 + (rnd() - 0.5) * 30; raw[i + 2] = 255 - v + (rnd() - 0.5) * 30;
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

const RECTS: Array<[number, number, number, number]> = [
  [0, 0, 16, 16], [16, 32, 32, 32], [128, 128, 128, 128], [600, 440, 40, 40], [3, 5, 61, 47],
];

describe('createPatchExtractor', () => {
  test.each(['jpeg', 'png', 'webp'] as const)('%s: byte-identical to the per-patch path', async (fmt) => {
    const base = await photo();
    const encoded = await sharp(base).toFormat(fmt).toBuffer();
    const extract = await createPatchExtractor(encoded);
    expect(extract).not.toBeNull();
    for (const [l, t, w, h] of RECTS) {
      const legacy = await sharp(encoded).extract({ left: l, top: t, width: w, height: h }).toBuffer();
      const fast = await extract!(l, t, w, h);
      expect(fast.equals(legacy)).toBe(true);
    }
  });

  test('grayscale and alpha images are also identical', async () => {
    const base = await photo();
    const gray = await sharp(base).grayscale().jpeg().toBuffer();
    const alpha = await sharp(base).ensureAlpha(0.7).png().toBuffer();
    for (const encoded of [gray, alpha]) {
      const extract = await createPatchExtractor(encoded);
      if (!extract) continue; // falling back to the per-patch path is always allowed
      for (const [l, t, w, h] of RECTS) {
        const legacy = await sharp(encoded).extract({ left: l, top: t, width: w, height: h }).toBuffer();
        expect((await extract(l, t, w, h)).equals(legacy)).toBe(true);
      }
    }
  });

  test('unsupported input falls back (returns null)', async () => {
    expect(await createPatchExtractor(Buffer.from('not an image'))).toBeNull();
    const gif = await sharp(await photo()).gif().toBuffer();
    expect(await createPatchExtractor(gif)).toBeNull();
  });
});

import { LocalDnaPatchGenerator } from '../../src/services/forensics/local-dna-patch-generator.service';

describe('fast grid vs the original per-patch computation', () => {
  test.each(['jpeg', 'png'] as const)('%s: every patch fingerprint is identical', async (fmt) => {
    const encoded = await sharp(await photo()).toFormat(fmt).toBuffer();
    const gen = new LocalDnaPatchGenerator();
    const grid = await gen.generateMultiScaleGrid(encoded, [32, 64]);
    expect(grid.patches.length).toBeGreaterThan(100);

    // Recompute a spread of patches the way the code did before: decode the whole file for
    // the crop, then decode the patch again for each feature.
    const g = gen as unknown as Record<string, (b: Buffer) => Promise<unknown>>;
    // (the default config also adds overlapping tiles, which are not on the scale grid)
    const gridCount = [32, 64].reduce((n, sc) => n + Math.ceil(W / sc) * Math.ceil(H / sc), 0);
    const pick = grid.patches.filter((_p, i) => i < gridCount && i % 23 === 0);
    for (const p of pick) {
      const size = p.scale;
      const left = p.gridX * size;
      const top = p.gridY * size;
      const width = Math.min(size, W - left);
      const height = Math.min(size, H - top);
      const buf = await sharp(encoded).extract({ left, top, width, height }).toBuffer();
      expect(p.pHash16).toBe(await g.computePHash16(buf));
      expect(p.dHash8).toBe(await g.computeDHash8(buf));
      expect(p.aHash8).toBe(await g.computeAHash8(buf));
      expect(p.edgeSignature).toBe(await g.computeEdgeSignature(buf));
      expect(p.colorVector).toEqual(await g.computeColorVector(buf));
      expect(p.frequencySig).toBe(await g.computeFrequencySig(buf));
      expect(p.textureSig).toBe(await g.computeTextureSig(buf));
    }
  }, 120_000);

  test('patch indices are consecutive in scan order', async () => {
    const grid = await new LocalDnaPatchGenerator().generateMultiScaleGrid(await photo(), [64]);
    grid.patches.forEach((p, i) => expect(p.patchIndex).toBe(i));
  }, 120_000);
});
