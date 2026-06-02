/**
 * PINIT-DNA — Layer 6 Unit Tests
 *
 * Tests LSB steganography against the spec:
 * "Hidden by changing the very last bit of the blue channel value in consecutive
 *  pixels. A pixel with blue value 200 (11001000) becomes 201 (11001001) —
 *  a change of just 1 unit, completely invisible to the eye."
 */

import sharp from 'sharp';
import { SteganographyLayer } from '../../src/services/layers/layer6.steganography';
import { ImageInput } from '../../src/types/dna.types';
import * as fs from 'fs/promises';

async function makeInput(buffer: Buffer): Promise<ImageInput> {
  return {
    filePath: '/tmp/test.png',
    originalName: 'test.png',
    mimeType: 'image/png',
    sizeBytes: buffer.length,
    buffer,
  };
}

// Make a plain PNG large enough to hold the 528-bit payload (needs 528+ pixels)
async function makeLargeEnoughImage(w = 64, h = 64) {
  const buf = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 128, g: 180, b: 220 } },
  }).png().toBuffer();
  return makeInput(buf);
}

describe('SteganographyLayer', () => {
  const layer = new SteganographyLayer();
  const DNA_ID = 'test-dna-record-id-001';

  it('returns success=true and embedded=true for a large enough image', async () => {
    const image = await makeLargeEnoughImage();
    const result = await layer.generate(image, DNA_ID);

    expect(result.success).toBe(true);
    expect(result.layer).toBe(6);
    expect(result.name).toBe('steganography');
    expect(result.data.embedded).toBe(true);
  });

  it('reports correct capacity and used bits', async () => {
    const image = await makeLargeEnoughImage(64, 64);
    const result = await layer.generate(image, DNA_ID);

    // 64×64 = 4096 pixels = 4096 capacity bits
    expect(result.data.capacityBits).toBe(4096);
    // 16 + 256 + 256 = 528 bits used
    expect(result.data.usedBits).toBe(528);
    expect(result.data.channel).toBe('B');
  });

  it('stores a 64-char HMAC hex string', async () => {
    const image = await makeLargeEnoughImage();
    const result = await layer.generate(image, DNA_ID);

    expect(result.data.payloadHmac).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different HMAC on each call (unique token per image)', async () => {
    const image = await makeLargeEnoughImage();
    const r1 = await layer.generate(image, DNA_ID);
    const r2 = await layer.generate(image, DNA_ID);

    // Each call generates a new random token → different HMAC
    expect(r1.data.payloadHmac).not.toBe(r2.data.payloadHmac);
  });

  it('carrier image is visually identical (pixel values differ by at most 1)', async () => {
    const image = await makeLargeEnoughImage(64, 64);
    const result = await layer.generate(image, DNA_ID);

    // Load original and carrier raw pixels
    const origRaw = await sharp(image.buffer).removeAlpha().raw().toBuffer();
    const carrierRaw = await sharp(result.data.carrierPath!).removeAlpha().raw().toBuffer();

    let maxDiff = 0;
    for (let i = 0; i < origRaw.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(origRaw[i] - carrierRaw[i]));
    }

    // LSB changes are at most 1 unit — spec: "a change of just 1 unit"
    expect(maxDiff).toBeLessThanOrEqual(1);
  });

  it('only modifies the blue channel (R and G channels unchanged)', async () => {
    const image = await makeLargeEnoughImage(64, 64);
    const result = await layer.generate(image, DNA_ID);

    const origRaw = await sharp(image.buffer).removeAlpha().raw().toBuffer();
    const carrierRaw = await sharp(result.data.carrierPath!).removeAlpha().raw().toBuffer();

    // Check R and G channels (indices 0 and 1 in each RGB triplet)
    for (let i = 0; i < origRaw.length; i += 3) {
      expect(carrierRaw[i]).toBe(origRaw[i]);       // R unchanged
      expect(carrierRaw[i + 1]).toBe(origRaw[i + 1]); // G unchanged
      // B may differ by 1 (LSB modification)
    }
  });

  it('fails for image too small to hold payload (< 528 pixels)', async () => {
    // 22×23 = 506 pixels < 528 required
    const smallBuf = await sharp({
      create: { width: 22, height: 23, channels: 3, background: { r: 100, g: 100, b: 100 } },
    }).png().toBuffer();
    const image = await makeInput(smallBuf);
    const result = await layer.generate(image, DNA_ID);

    expect(result.success).toBe(false);
    expect(result.data.embedded).toBe(false);
  });

  describe('verifyAsync()', () => {
    it('returns 1.0 when verifying the carrier image (exact match)', async () => {
      const image = await makeLargeEnoughImage();
      const generated = await layer.generate(image, DNA_ID);

      // Load the carrier image
      const carrierBuf = await fs.readFile(generated.data.carrierPath!);
      const carrierInput = await makeInput(carrierBuf);

      const score = await layer.verifyAsync(carrierInput, {
        payloadHmac: generated.data.payloadHmac,
        channel: 'B',
        embedded: true,
      });

      expect(score).toBe(1.0);
    });

    it('returns 0.0 for image with no embedded signature', async () => {
      const image = await makeLargeEnoughImage();
      // Generate on image1, verify against image2 (no signature)
      const generated = await layer.generate(image, DNA_ID);
      const cleanImage = await makeLargeEnoughImage(); // fresh image, no embedding

      const score = await layer.verifyAsync(cleanImage, {
        payloadHmac: generated.data.payloadHmac,
        channel: 'B',
        embedded: true,
      });

      // Magic header not found → 0.0
      expect(score).toBe(0.0);
    });

    it('returns 0 when embedded=false in stored record', async () => {
      const image = await makeLargeEnoughImage();
      const score = await layer.verifyAsync(image, {
        payloadHmac: 'a'.repeat(64),
        channel: 'B',
        embedded: false,
      });
      expect(score).toBe(0);
    });
  });

  afterAll(async () => {
    // Clean up carrier files created during tests
    const files = await fs.readdir('./tmp/uploads').catch(() => []);
    for (const file of files) {
      if (file.startsWith('carrier_l6_')) {
        await fs.unlink(`./tmp/uploads/${file}`).catch(() => {});
      }
    }
  });
});
