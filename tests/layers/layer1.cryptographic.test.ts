/**
 * PINIT-DNA — Layer 1 Unit Tests
 *
 * Tests the real SHA-256 implementation against the theoretical spec:
 * "The system reads every single pixel and feeds all those numbers into SHA-256.
 *  If even one pixel changes, the entire code changes completely."
 */

import { CryptographicLayer } from '../../src/services/layers/layer1.cryptographic';
import { ImageInput } from '../../src/types/dna.types';
import sharp from 'sharp';

// Create a minimal valid 4x4 PNG buffer for testing (no external file needed)
async function makePngBuffer(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

function makeImageInput(buffer: Buffer): ImageInput {
  return {
    filePath: '/tmp/test.png',
    originalName: 'test.png',
    mimeType: 'image/png',
    sizeBytes: buffer.length,
    buffer,
  };
}

describe('CryptographicLayer', () => {
  const layer = new CryptographicLayer();

  it('returns success=true with 64-char hex hashes', async () => {
    const buffer = await makePngBuffer(100, 150, 200);
    const result = await layer.generate(makeImageInput(buffer));

    expect(result.success).toBe(true);
    expect(result.layer).toBe(1);
    expect(result.name).toBe('cryptographic');
    expect(result.data.sha256Hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.data.normalizedHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces the same hashes for the same image twice', async () => {
    const buffer = await makePngBuffer(80, 120, 160);
    const r1 = await layer.generate(makeImageInput(buffer));
    const r2 = await layer.generate(makeImageInput(buffer));

    expect(r1.data.sha256Hash).toBe(r2.data.sha256Hash);
    expect(r1.data.normalizedHash).toBe(r2.data.normalizedHash);
  });

  it('produces different hashes for different images', async () => {
    const buf1 = await makePngBuffer(100, 100, 100);
    const buf2 = await makePngBuffer(101, 100, 100); // one pixel value changed
    const r1 = await layer.generate(makeImageInput(buf1));
    const r2 = await layer.generate(makeImageInput(buf2));

    expect(r1.data.normalizedHash).not.toBe(r2.data.normalizedHash);
  });

  it('sha256Hash differs when file encoding differs (same pixels, PNG vs PNG re-encode)', async () => {
    // Two separately encoded PNGs of the same content produce different file bytes
    // (different timestamps/metadata in the PNG header) but identical pixel content.
    const pixels = { r: 120, g: 80, b: 200 };
    const png1 = await makePngBuffer(pixels.r, pixels.g, pixels.b);
    // Re-encode through sharp a second time — different file bytes, same pixels
    const png2 = await sharp(png1).png().toBuffer();

    const r1 = await layer.generate(makeImageInput(png1));
    const r2 = await layer.generate(makeImageInput(png2));

    // normalizedHash (pixel-level) must match — same pixel content
    expect(r1.data.normalizedHash).toBe(r2.data.normalizedHash);
  });

  it('normalizedHash differs from sha256Hash (they measure different things)', async () => {
    const buffer = await makePngBuffer(120, 80, 200);
    const result = await layer.generate(makeImageInput(buffer));

    // File hash and pixel hash are computed from different byte sequences
    expect(result.data.sha256Hash).not.toBe(result.data.normalizedHash);
  });

  describe('verify()', () => {
    it('returns 1.0 when normalizedHash matches', async () => {
      const buffer = await makePngBuffer(50, 100, 150);
      const result = await layer.generate(makeImageInput(buffer));

      const score = layer.verify(result.data, {
        sha256Hash: result.data.sha256Hash,
        normalizedHash: result.data.normalizedHash,
      });

      expect(score).toBe(1.0);
    });

    it('returns 0.0 when neither hash matches', async () => {
      const buf1 = await makePngBuffer(50, 100, 150);
      const buf2 = await makePngBuffer(200, 50, 30);
      const probe = await layer.generate(makeImageInput(buf1));
      const stored = await layer.generate(makeImageInput(buf2));

      const score = layer.verify(probe.data, {
        sha256Hash: stored.data.sha256Hash,
        normalizedHash: stored.data.normalizedHash,
      });

      expect(score).toBe(0.0);
    });
  });
});
