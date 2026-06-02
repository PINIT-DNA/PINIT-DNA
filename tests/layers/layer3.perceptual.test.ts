/**
 * PINIT-DNA — Layer 3 Unit Tests
 *
 * Tests DCT-based pHash, aHash, and dHash against the spec:
 * "Two visually similar images produce similar codes;
 *  two completely different images produce different codes."
 */

import sharp from 'sharp';
import { PerceptualLayer } from '../../src/services/layers/layer3.perceptual';
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

// Solid colour image
async function makeSolid(r: number, g: number, b: number, w = 64, h = 64) {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: { r, g, b } },
  }).png().toBuffer();
  return makeInput(buf);
}

// Gradient image (left dark → right bright)
async function makeGradient(w = 64, h = 64) {
  const pixels = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255);
      const i = (y * w + x) * 3;
      pixels[i] = v; pixels[i + 1] = v; pixels[i + 2] = v;
    }
  }
  const buf = await sharp(Buffer.from(pixels), { raw: { width: w, height: h, channels: 3 } })
    .png().toBuffer();
  return makeInput(buf);
}

// Re-encode image at different JPEG quality (simulates social media re-compression)
async function recompress(image: ImageInput, quality: number): Promise<ImageInput> {
  const buf = await sharp(image.buffer).jpeg({ quality }).png().toBuffer();
  return makeInput(buf);
}

describe('PerceptualLayer', () => {
  const layer = new PerceptualLayer();

  it('returns success=true with correctly sized hashes', async () => {
    const image = await makeGradient();
    const result = await layer.generate(image);

    expect(result.success).toBe(true);
    expect(result.layer).toBe(3);
    expect(result.name).toBe('perceptual');
    expect(result.data.pHash64).toMatch(/^[0-9a-f]{16}$/);
    expect(result.data.pHash256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data.aHash64).toMatch(/^[0-9a-f]{16}$/);
    expect(result.data.dHash64).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces the same hashes for the same image twice', async () => {
    const image = await makeGradient();
    const r1 = await layer.generate(image);
    const r2 = await layer.generate(image);

    expect(r1.data.pHash64).toBe(r2.data.pHash64);
    expect(r1.data.aHash64).toBe(r2.data.aHash64);
    expect(r1.data.dHash64).toBe(r2.data.dHash64);
  });

  it('produces different pHash for visually different images', async () => {
    const dark = await makeSolid(10, 10, 10);
    const bright = await makeSolid(245, 245, 245);
    const gradient = await makeGradient();

    const r1 = await layer.generate(dark);
    const r2 = await layer.generate(bright);
    const r3 = await layer.generate(gradient);

    expect(r1.data.pHash64).not.toBe(r2.data.pHash64);
    expect(r1.data.pHash64).not.toBe(r3.data.pHash64);
    expect(r2.data.pHash64).not.toBe(r3.data.pHash64);
  });

  it('pHash survives JPEG re-compression (spec requirement)', async () => {
    const original = await makeGradient(128, 128);
    const compressed = await recompress(original, 75);

    const r1 = await layer.generate(original);
    const r2 = await layer.generate(compressed);

    // After JPEG compression, pHash should still be very similar
    const score = layer.verify(r2.data, {
      pHash64: r1.data.pHash64,
      aHash64: r1.data.aHash64,
      dHash64: r1.data.dHash64,
    });

    expect(score).toBeGreaterThan(0.75);
  });

  it('pHash survives resize (spec requirement)', async () => {
    const original = await makeGradient(128, 128);
    // Resize to half dimensions
    const resizedBuf = await sharp(original.buffer).resize(64, 64).png().toBuffer();
    const resized = await makeInput(resizedBuf);

    const r1 = await layer.generate(original);
    const r2 = await layer.generate(resized);

    const score = layer.verify(r2.data, {
      pHash64: r1.data.pHash64,
      aHash64: r1.data.aHash64,
      dHash64: r1.data.dHash64,
    });

    expect(score).toBeGreaterThan(0.75);
  });

  it('pHash survives minor brightness change', async () => {
    const original = await makeGradient(64, 64);
    // Apply slight brightness increase
    const brightenedBuf = await sharp(original.buffer)
      .modulate({ brightness: 1.15 })
      .png()
      .toBuffer();
    const brightened = await makeInput(brightenedBuf);

    const r1 = await layer.generate(original);
    const r2 = await layer.generate(brightened);

    const score = layer.verify(r2.data, {
      pHash64: r1.data.pHash64,
      aHash64: r1.data.aHash64,
      dHash64: r1.data.dHash64,
    });

    expect(score).toBeGreaterThan(0.75);
  });

  describe('verify()', () => {
    it('returns 1.0 for identical images', async () => {
      const image = await makeGradient();
      const result = await layer.generate(image);

      const score = layer.verify(result.data, {
        pHash64: result.data.pHash64,
        aHash64: result.data.aHash64,
        dHash64: result.data.dHash64,
      });

      expect(score).toBe(1.0);
    });

    it('returns low score for completely different images', async () => {
      const dark = await makeSolid(0, 0, 0);
      const gradient = await makeGradient();

      const r1 = await layer.generate(dark);
      const r2 = await layer.generate(gradient);

      const score = layer.verify(r1.data, {
        pHash64: r2.data.pHash64,
        aHash64: r2.data.aHash64,
        dHash64: r2.data.dHash64,
      });

      expect(score).toBeLessThan(0.8);
    });

    it('returns 0 for empty/missing hashes', () => {
      const score = layer.verify(
        { pHash64: '', pHash256: '', aHash64: '', dHash64: '' },
        { pHash64: 'abc', aHash64: 'abc', dHash64: 'abc' }
      );
      expect(score).toBe(0);
    });
  });
});
