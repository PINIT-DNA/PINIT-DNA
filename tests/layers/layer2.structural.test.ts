/**
 * PINIT-DNA — Layer 2 Unit Tests
 *
 * Tests Sobel edge detection and structural signature against the spec:
 * "Analyses edge patterns row by row and creates a signature number.
 *  Hidden in red channel LSBs at edge pixel locations."
 *
 * Test images use stripe patterns (8-pixel bands) because 1-pixel checkerboards
 * cancel out in the Sobel 3×3 kernel — a known property of 1px periodic patterns.
 */

import sharp from 'sharp';
import { StructuralLayer } from '../../src/services/layers/layer2.structural';
import { ImageInput } from '../../src/types/dna.types';

async function makeImageInput(
  width: number,
  height: number,
  fillFn: (x: number, y: number) => { r: number; g: number; b: number }
): Promise<ImageInput> {
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { r, g, b } = fillFn(x, y);
      const i = (y * width + x) * 3;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    }
  }
  const buffer = await sharp(Buffer.from(pixels), {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();

  return {
    filePath: '/tmp/test.png',
    originalName: 'test.png',
    mimeType: 'image/png',
    sizeBytes: buffer.length,
    buffer,
  };
}

// Vertical stripes — strong vertical edges (Sobel Gx dominant)
async function makeVerticalStripes(w: number, h: number) {
  return makeImageInput(w, h, (x) => {
    return Math.floor(x / 8) % 2 === 0
      ? { r: 255, g: 255, b: 255 }
      : { r: 0, g: 0, b: 0 };
  });
}

// Horizontal stripes — strong horizontal edges (Sobel Gy dominant)
async function makeHorizontalStripes(w: number, h: number) {
  return makeImageInput(w, h, (_x, y) => {
    return Math.floor(y / 8) % 2 === 0
      ? { r: 255, g: 255, b: 255 }
      : { r: 0, g: 0, b: 0 };
  });
}

// Solid image — no edges
async function makeSolid(w: number, h: number) {
  return makeImageInput(w, h, () => ({ r: 128, g: 128, b: 128 }));
}

describe('StructuralLayer', () => {
  const layer = new StructuralLayer();

  it('returns success=true and a 16-char hex signature', async () => {
    const image = await makeVerticalStripes(64, 64);
    const result = await layer.generate(image);

    expect(result.success).toBe(true);
    expect(result.layer).toBe(2);
    expect(result.name).toBe('structural');
    expect(result.data.edgeSignature64).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns 64 edge vectors', async () => {
    const image = await makeVerticalStripes(64, 64);
    const result = await layer.generate(image);

    expect(result.data.edgeVectors).toHaveLength(64);
    result.data.edgeVectors.forEach((v) => {
      expect(v.angle).toBeGreaterThanOrEqual(0);
      expect(v.angle).toBeLessThanOrEqual(360);
      expect(v.magnitude).toBeGreaterThanOrEqual(0);
      expect(v.magnitude).toBeLessThanOrEqual(1);
    });
  });

  it('produces the same signature for the same image twice', async () => {
    const image = await makeVerticalStripes(64, 64);
    const r1 = await layer.generate(image);
    const r2 = await layer.generate(image);

    expect(r1.data.edgeSignature64).toBe(r2.data.edgeSignature64);
  });

  it('produces different signatures for vertical vs horizontal stripes', async () => {
    // Vertical stripes → strong edges in left-right zones
    // Horizontal stripes → strong edges in top-bottom zones
    // Different zone densities → different signatures
    const vertical = await makeVerticalStripes(64, 64);
    const horizontal = await makeHorizontalStripes(64, 64);

    const r1 = await layer.generate(vertical);
    const r2 = await layer.generate(horizontal);

    expect(r1.data.edgeSignature64).not.toBe(r2.data.edgeSignature64);
  });

  it('solid colour image produces all-zero signature (no edges)', async () => {
    const image = await makeSolid(64, 64);
    const result = await layer.generate(image);

    expect(result.success).toBe(true);
    expect(result.data.edgeSignature64).toBe('0000000000000000');
  });

  it('returns a non-empty base64 edge map', async () => {
    const image = await makeVerticalStripes(64, 64);
    const result = await layer.generate(image);

    expect(result.data.edgeMapB64.length).toBeGreaterThan(0);
    expect(() => Buffer.from(result.data.edgeMapB64, 'base64')).not.toThrow();
  });

  describe('verify()', () => {
    it('returns 1.0 for identical signatures', async () => {
      const image = await makeVerticalStripes(64, 64);
      const result = await layer.generate(image);

      const score = layer.verify(result.data, {
        edgeSignature64: result.data.edgeSignature64,
      });

      expect(score).toBe(1.0);
    });

    it('returns low score for vertical vs horizontal stripes', async () => {
      // Completely different edge orientations → different zone densities → low similarity
      const vertical = await makeVerticalStripes(64, 64);
      const horizontal = await makeHorizontalStripes(64, 64);

      const r1 = await layer.generate(vertical);
      const r2 = await layer.generate(horizontal);

      const score = layer.verify(r1.data, {
        edgeSignature64: r2.data.edgeSignature64,
      });

      expect(score).toBeLessThan(0.8);
    });

    it('returns high score for same structure with brightness change', async () => {
      // Same vertical stripe structure, slightly reduced contrast
      const original = await makeVerticalStripes(64, 64);
      const dimmed = await makeImageInput(64, 64, (x) => {
        return Math.floor(x / 8) % 2 === 0
          ? { r: 220, g: 220, b: 220 }  // was 255 — slightly dimmer
          : { r: 35, g: 35, b: 35 };    // was 0 — slightly brighter
      });

      const r1 = await layer.generate(original);
      const r2 = await layer.generate(dimmed);

      const score = layer.verify(r2.data, {
        edgeSignature64: r1.data.edgeSignature64,
      });

      // Same structure → same edge zones → same signature → score = 1.0
      expect(score).toBeGreaterThan(0.7);
    });
  });
});
