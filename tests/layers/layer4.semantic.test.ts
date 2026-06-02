/**
 * PINIT-DNA — Layer 4 Unit Tests
 *
 * Tests RGB histogram descriptor against the spec:
 * "Divides all possible colours into 8 groups and counts how many pixels fall
 *  into each group for R, G, B separately — a compact 24-number description
 *  of the image's colour personality."
 */

import sharp from 'sharp';
import { SemanticLayer } from '../../src/services/layers/layer4.semantic';
import { ImageInput } from '../../src/types/dna.types';

async function makeInput(buffer: Buffer): Promise<ImageInput> {
  return {
    filePath: '/tmp/test.png',
    originalName: 'test.png',
    mimeType: 'image/png',
    sizeBytes: buffer.length,
    buffer,
  };
}

// Pure solid colour image
async function makeSolid(r: number, g: number, b: number, w = 64, h = 64) {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: { r, g, b } },
  }).png().toBuffer();
  return makeInput(buf);
}

// Half red, half blue image
async function makeHalfRedHalfBlue(w = 64, h = 64) {
  const pixels = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      if (x < w / 2) { pixels[i] = 255; pixels[i + 1] = 0; pixels[i + 2] = 0; }
      else            { pixels[i] = 0;   pixels[i + 1] = 0; pixels[i + 2] = 255; }
    }
  }
  const buf = await sharp(Buffer.from(pixels), {
    raw: { width: w, height: h, channels: 3 },
  }).png().toBuffer();
  return makeInput(buf);
}

describe('SemanticLayer', () => {
  const layer = new SemanticLayer();

  it('returns success=true with correctly sized histograms', async () => {
    const image = await makeSolid(128, 64, 32);
    const result = await layer.generate(image);

    expect(result.success).toBe(true);
    expect(result.layer).toBe(4);
    expect(result.name).toBe('semantic');
    expect(result.data.histogramR).toHaveLength(256);
    expect(result.data.histogramG).toHaveLength(256);
    expect(result.data.histogramB).toHaveLength(256);
    expect(result.data.histogramH).toHaveLength(360);
    expect(result.data.histogramS).toHaveLength(100);
  });

  it('returns a 12-char hex colour fingerprint', async () => {
    const image = await makeSolid(200, 100, 50);
    const result = await layer.generate(image);

    expect(result.data.colorFingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it('produces the same fingerprint for the same image twice', async () => {
    const image = await makeSolid(80, 160, 200);
    const r1 = await layer.generate(image);
    const r2 = await layer.generate(image);

    expect(r1.data.colorFingerprint).toBe(r2.data.colorFingerprint);
  });

  it('produces different fingerprints for different colour images', async () => {
    const red   = await makeSolid(220, 20, 20);
    const green = await makeSolid(20, 220, 20);
    const blue  = await makeSolid(20, 20, 220);

    const r1 = await layer.generate(red);
    const r2 = await layer.generate(green);
    const r3 = await layer.generate(blue);

    expect(r1.data.colorFingerprint).not.toBe(r2.data.colorFingerprint);
    expect(r1.data.colorFingerprint).not.toBe(r3.data.colorFingerprint);
    expect(r2.data.colorFingerprint).not.toBe(r3.data.colorFingerprint);
  });

  it('red image has dominant red histogram bin', async () => {
    const image = await makeSolid(230, 10, 10);
    const result = await layer.generate(image);

    // Bin 7 (values 224–255) should dominate the R histogram
    const highBinR = result.data.histogramR.slice(224).reduce((a, b) => a + b, 0);
    const totalR = result.data.histogramR.reduce((a, b) => a + b, 0);
    expect(highBinR / totalR).toBeGreaterThan(0.9);

    // G and B histograms should be concentrated in low bins
    const lowBinG = result.data.histogramG.slice(0, 32).reduce((a, b) => a + b, 0);
    const totalG = result.data.histogramG.reduce((a, b) => a + b, 0);
    expect(lowBinG / totalG).toBeGreaterThan(0.9);
  });

  it('returns up to 5 dominant colours', async () => {
    const image = await makeHalfRedHalfBlue();
    const result = await layer.generate(image);

    expect(result.data.dominantColors.length).toBeGreaterThan(0);
    expect(result.data.dominantColors.length).toBeLessThanOrEqual(5);

    result.data.dominantColors.forEach((c) => {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.coverage).toBeGreaterThan(0);
      expect(c.coverage).toBeLessThanOrEqual(1);
    });
  });

  it('dominant colour coverages sum to approximately 1', async () => {
    // For a solid image, the single colour should cover ~100%
    const image = await makeSolid(100, 150, 200);
    const result = await layer.generate(image);

    const totalCoverage = result.data.dominantColors.reduce(
      (sum, c) => sum + c.coverage,
      0
    );
    // For a solid image top colour should cover nearly all pixels
    expect(result.data.dominantColors[0].coverage).toBeGreaterThan(0.9);
    expect(totalCoverage).toBeLessThanOrEqual(1.01);
  });

  describe('verify()', () => {
    it('returns 1.0 for identical images', async () => {
      const image = await makeSolid(100, 150, 200);
      const result = await layer.generate(image);

      const score = layer.verify(result.data, {
        histogramR: result.data.histogramR,
        histogramG: result.data.histogramG,
        histogramB: result.data.histogramB,
        colorFingerprint: result.data.colorFingerprint,
      });

      expect(score).toBe(1.0);
    });

    it('returns high score for same image after minor brightness change', async () => {
      const original = await makeSolid(120, 80, 160);
      const brightenedBuf = await sharp(original.buffer)
        .modulate({ brightness: 1.1 })
        .png()
        .toBuffer();
      const brightened = await makeInput(brightenedBuf);

      const r1 = await layer.generate(original);
      const r2 = await layer.generate(brightened);

      const score = layer.verify(r2.data, {
        histogramR: r1.data.histogramR,
        histogramG: r1.data.histogramG,
        histogramB: r1.data.histogramB,
        colorFingerprint: r1.data.colorFingerprint,
      });

      // Minor brightness shift moves some pixels across bin boundaries.
      // With 8 coarse bins, a 10% brightness change can shift one channel's
      // dominant bin — so 2/3 channels still match (score ≥ 0.6).
      expect(score).toBeGreaterThan(0.6);
    });

    it('returns low score for completely different colour images', async () => {
      const red  = await makeSolid(230, 10, 10);
      const blue = await makeSolid(10, 10, 230);

      const r1 = await layer.generate(red);
      const r2 = await layer.generate(blue);

      const score = layer.verify(r1.data, {
        histogramR: r2.data.histogramR,
        histogramG: r2.data.histogramG,
        histogramB: r2.data.histogramB,
        colorFingerprint: r2.data.colorFingerprint,
      });

      expect(score).toBeLessThan(0.5);
    });

    it('returns 0 for empty histograms', () => {
      const score = layer.verify(
        {
          histogramR: [], histogramG: [], histogramB: [],
          histogramH: [], histogramS: [],
          dominantColors: [], colorFingerprint: '',
        },
        { histogramR: [1], histogramG: [1], histogramB: [1], colorFingerprint: '' }
      );
      expect(score).toBe(0);
    });
  });
});
