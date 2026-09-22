/**
 * Compact frame DNA — the fast raw-pixel fingerprints must stay forensically usable.
 *
 * Protecting every frame is only affordable because patches are fingerprinted
 * straight from decoded pixels instead of running seven image pipelines per patch
 * (measured 456 ms/frame vs 36 s/frame). That optimisation is only allowed if the
 * fingerprints still do their job, which is what this file checks:
 *
 *  1. the grid has the same shape and ordering as the encoded-image grid, so a pack
 *     is a drop-in for the patch rows it replaces;
 *  2. it is deterministic — the same pixels always give the same fingerprints, which
 *     is what makes a stored frame re-derivable;
 *  3. a re-compressed copy of the frame still matches, which is the real forensic
 *     case (a leaked video is always re-encoded);
 *  4. it still agrees with the encoded-image path well enough for the island rule
 *     (a fragment hit needs 6 matching patches) — measured, not assumed.
 */
import { describe, test, expect } from '@jest/globals';
import sharp from 'sharp';
import {
  localDnaPatchGenerator,
  patchDenseMatch,
} from '../../src/services/forensics/local-dna-patch-generator.service';
import { buildRawPatchGrid } from '../../src/services/videos/frame-dna/raw-patch-grid';

const WIDTH = 640;
const HEIGHT = 480;

/** Something with structure, texture and flat areas — closer to a real frame than noise. */
function syntheticFrame(shift = 0): Buffer {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      const box = x > 120 && x < 300 && y > 90 && y < 260 ? 60 : 0;
      const grain = ((x * 7 + y * 13) % 17) * 3;
      rgb[i] = Math.min(255, 90 + box + grain + shift);
      rgb[i + 1] = Math.min(255, 140 + Math.round(60 * Math.sin(x / 30)) + box);
      rgb[i + 2] = Math.min(255, 180 + Math.round(40 * Math.cos(y / 25)));
    }
  }
  return rgb;
}

function agreement(a: ReturnType<typeof buildRawPatchGrid>, b: { patches: typeof a.patches }): number {
  const compared = Math.min(a.patches.length, b.patches.length);
  let matched = 0;
  for (let i = 0; i < compared; i++) {
    if (patchDenseMatch(a.patches[i]!, b.patches[i]!)) matched += 1;
  }
  return matched / compared;
}

describe('fast raw patch grid', () => {
  const rgb = syntheticFrame();

  // The encoded-image path takes tens of seconds for one frame — that slowness is
  // the thing this change fixes, so the comparison tests need room to run it.
  const SLOW = 180_000;

  test('produces the same grid shape as the encoded-image path', async () => {
    const png = await sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
    const encoded = await localDnaPatchGenerator.generateMultiScaleGrid(png);
    const fast = buildRawPatchGrid(rgb, WIDTH, HEIGHT);

    expect(fast.patches).toHaveLength(encoded.patches.length);
    expect(fast.scales).toEqual(encoded.scales);
    expect(fast.patchSize).toBe(encoded.patchSize);

    // Same patch in the same place, so a pack decodes into rows the matchers can use.
    for (const i of [0, 100, fast.patches.length - 1]) {
      expect(fast.patches[i]!.patchIndex).toBe(encoded.patches[i]!.patchIndex);
      expect(fast.patches[i]!.gridX).toBe(encoded.patches[i]!.gridX);
      expect(fast.patches[i]!.gridY).toBe(encoded.patches[i]!.gridY);
      expect(fast.patches[i]!.scale).toBe(encoded.patches[i]!.scale);
    }
  }, SLOW);

  test('every descriptor has the width the pack format requires', () => {
    const fast = buildRawPatchGrid(rgb, WIDTH, HEIGHT);
    for (const p of [fast.patches[0]!, fast.patches[500]!, fast.patches[fast.patches.length - 1]!]) {
      expect(p.pHash16).toMatch(/^[0-9a-f]{16}$/);
      expect(p.dHash8).toMatch(/^[0-9a-f]{8}$/);
      expect(p.aHash8).toMatch(/^[0-9a-f]{8}$/);
      expect(p.edgeSignature).toMatch(/^[0-9a-f]{2}$/);
      expect(p.frequencySig).toMatch(/^[0-9a-f]{2}$/);
      expect(p.textureSig).toMatch(/^[0-9a-f]{2}$/);
      expect(p.colorVector.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)).toBe(true);
    }
  });

  test('is deterministic — a stored frame can be re-derived exactly', () => {
    expect(buildRawPatchGrid(rgb, WIDTH, HEIGHT).patches)
      .toEqual(buildRawPatchGrid(syntheticFrame(), WIDTH, HEIGHT).patches);
  });

  test('a re-compressed copy of the frame still matches', async () => {
    // What actually happens to a leaked video: re-encoded, decoded again, compared.
    const recompressed = await sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
      .jpeg({ quality: 70 })
      .toBuffer();
    const { data } = await sharp(recompressed).removeAlpha().raw().toBuffer({ resolveWithObject: true });

    const ratio = agreement(buildRawPatchGrid(rgb, WIDTH, HEIGHT), buildRawPatchGrid(data, WIDTH, HEIGHT));
    // A fragment hit needs 6 matching patches out of thousands; this is far above it.
    expect(ratio).toBeGreaterThan(0.8);
  }, 60_000);

  test('still agrees with the encoded-image path well enough to find fragments', async () => {
    const png = await sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
    const encoded = await localDnaPatchGenerator.generateMultiScaleGrid(png);
    const fast = buildRawPatchGrid(rgb, WIDTH, HEIGHT);

    // Box averaging and lanczos resampling differ most on smooth gradients, so exact
    // hash equality is NOT expected across the two paths. What matters is that a
    // probe fingerprinted the old way still lands far more than the 6 matching
    // patches an island needs. (Video investigation avoids the drift entirely: it
    // fingerprints the probe the same fast way when candidates are compact frames.)
    expect(agreement(fast, encoded)).toBeGreaterThan(0.5);
  }, SLOW);
});
