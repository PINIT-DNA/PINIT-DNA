import sharp from 'sharp';
import { PerceptualLayer } from '../../src/services/layers/layer3.perceptual';
import { decidePublicScan, POSSIBLE_VISUAL } from '../../src/services/scan/public-scan-decision';

const layer = new PerceptualLayer();

function noise(seed: number, width = 48, height = 40): Buffer {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(rnd() * 256);
  return raw;
}

async function png(seed: number): Promise<Buffer> {
  return sharp(noise(seed), { raw: { width: 48, height: 40, channels: 3 } }).png().toBuffer();
}

describe('public scan visual thresholds, measured', () => {
  test('200 unrelated images stay below a possible match', async () => {
    const librarySeeds = [11, 22, 33, 44, 55, 66, 77, 88];
    const library = await Promise.all(librarySeeds.map(async (seed) => layer.computeFingerprints(await png(seed))));
    const unrelated = 200;
    let possible = 0;
    let protectedCount = 0;
    let maxUnrelated = 0;
    for (let i = 0; i < unrelated; i++) {
      const probe = await layer.computeFingerprints(await png(1000 + i));
      let best = 0;
      for (const stored of library) best = Math.max(best, layer.verify(probe, stored));
      maxUnrelated = Math.max(maxUnrelated, best);
      const verdict = decidePublicScan({ markFound: false, visual: best, featureConfirmed: false });
      if (verdict === 'possible') possible += 1;
      if (verdict === 'protected') protectedCount += 1;
    }
    expect(possible).toBe(0);
    expect(protectedCount).toBe(0);
    expect(maxUnrelated).toBeLessThan(POSSIBLE_VISUAL);
  }, 180000);

  test('re-saves of one image, pinned', async () => {
    const original = await sharp(noise(11, 160, 120), { raw: { width: 160, height: 120, channels: 3 } }).png().toBuffer();
    const stored = await layer.computeFingerprints(original);
    const variants: Array<[string, Buffer]> = [
      ['jpeg q75', await sharp(original).jpeg({ quality: 75 }).toBuffer()],
      ['jpeg q40', await sharp(original).jpeg({ quality: 40 }).toBuffer()],
      ['resize 50%', await sharp(original).resize(80).png().toBuffer()],
      ['grayscale', await sharp(original).grayscale().png().toBuffer()],
      ['screenshot style', await sharp(await sharp(original).resize(128).blur(0.6).toBuffer()).jpeg({ quality: 70 }).toBuffer()],
    ];
    const scored: Record<string, string> = {};
    for (const [name, buffer] of variants) {
      const probe = await layer.computeFingerprints(buffer);
      const visual = layer.verify(probe, stored);
      const verdict = decidePublicScan({ markFound: false, visual, featureConfirmed: false });
      scored[name] = `${visual.toFixed(3)} ${verdict}`;
    }
    // Pinned 2026-10-08 on one noise image, not a photograph of a screen or a print.
    expect(scored['jpeg q75']).toBe('0.919 possible');
    expect(scored['jpeg q40']).toBe('0.856 not_found');
    expect(scored['resize 50%']).toBe('0.909 possible');
    expect(scored.grayscale).toBe('1.000 protected');
    expect(scored['screenshot style']).toBe('0.897 not_found');
  });
});
