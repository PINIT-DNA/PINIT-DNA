/**
 * PINIT-DNA — Layer 5 Unit Tests
 *
 * Tests C2PA-style provenance record and EXIF extraction against the spec:
 * "Creates a structured record containing: creation timestamp, session ID,
 *  tool name and version, and a cryptographic link to the Layer 1 hash."
 */

import sharp from 'sharp';
import { MetadataLayer } from '../../src/services/layers/layer5.metadata';
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

// Plain PNG with no EXIF data
async function makePlainPng() {
  const buf = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 128, g: 128, b: 128 } },
  }).png().toBuffer();
  return makeInput(buf);
}

// JPEG with EXIF metadata embedded
async function makeJpegWithExif() {
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  return makeInput(buf);
}

describe('MetadataLayer', () => {
  const layer = new MetadataLayer();

  it('returns success=true for image with no EXIF', async () => {
    const image = await makePlainPng();
    const result = await layer.generate(image);

    expect(result.success).toBe(true);
    expect(result.layer).toBe(5);
    expect(result.name).toBe('metadata');
  });

  it('returns a 64-char SHA-256 metadataHash', async () => {
    const image = await makePlainPng();
    const result = await layer.generate(image);

    expect(result.data.metadataHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces the same metadataHash for the same image and dnaRecordId', async () => {
    const image = await makePlainPng();
    const id = 'test-dna-id-123';

    const r1 = await layer.generate(image, id, 'abc123hash');
    const r2 = await layer.generate(image, id, 'abc123hash');

    expect(r1.data.metadataHash).toBe(r2.data.metadataHash);
  });

  it('produces different metadataHash when dnaRecordId changes', async () => {
    const image = await makePlainPng();

    const r1 = await layer.generate(image, 'id-aaa');
    const r2 = await layer.generate(image, 'id-bbb');

    expect(r1.data.metadataHash).not.toBe(r2.data.metadataHash);
  });

  it('produces different metadataHash when layer1Hash changes', async () => {
    const image = await makePlainPng();

    const r1 = await layer.generate(image, 'same-id', 'hash-aaa');
    const r2 = await layer.generate(image, 'same-id', 'hash-bbb');

    expect(r1.data.metadataHash).not.toBe(r2.data.metadataHash);
  });

  it('image with no EXIF has null device fields', async () => {
    const image = await makePlainPng();
    const result = await layer.generate(image);

    // A synthetically created PNG has no camera EXIF
    expect(result.data.deviceMake).toBeNull();
    expect(result.data.deviceModel).toBeNull();
    expect(result.data.capturedAt).toBeNull();
    expect(result.data.gpsLatitude).toBeNull();
    expect(result.data.gpsLongitude).toBeNull();
  });

  it('processes JPEG image without error', async () => {
    const image = await makeJpegWithExif();
    const result = await layer.generate(image);

    expect(result.success).toBe(true);
    expect(result.data.metadataHash).toMatch(/^[a-f0-9]{64}$/);
  });

  describe('verify()', () => {
    it('returns 1.0 when metadataHash matches exactly', async () => {
      const image = await makePlainPng();
      const result = await layer.generate(image, 'test-id', 'hash-ref');

      const score = layer.verify(result.data, {
        deviceMake: result.data.deviceMake,
        deviceModel: result.data.deviceModel,
        capturedAt: result.data.capturedAt,
        metadataHash: result.data.metadataHash,
      });

      expect(score).toBe(1.0);
    });

    it('returns 0.0 when metadataHash does not match and no fields match', async () => {
      const image = await makePlainPng();
      const result = await layer.generate(image);

      const score = layer.verify(result.data, {
        deviceMake: 'Canon',
        deviceModel: 'EOS 5D',
        capturedAt: new Date('2020-01-01'),
        metadataHash: 'a'.repeat(64), // wrong hash
      });

      expect(score).toBe(0.0);
    });

    it('returns partial score when device fields match but hash differs', async () => {
      const probe = {
        exifData: null,
        deviceMake: 'Apple',
        deviceModel: 'iPhone 15',
        software: null,
        capturedAt: null,
        gpsLatitude: null,
        gpsLongitude: null,
        iptcData: null,
        xmpData: null,
        metadataHash: 'probe_hash_different',
      };

      const score = layer.verify(probe, {
        deviceMake: 'Apple',
        deviceModel: 'iPhone 15',
        capturedAt: null,
        metadataHash: 'stored_hash_different',
      });

      // Both make and model match → partial score
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it('returns 0 when both hashes are empty', () => {
      const score = layer.verify(
        { exifData: null, deviceMake: null, deviceModel: null, software: null,
          capturedAt: null, gpsLatitude: null, gpsLongitude: null,
          iptcData: null, xmpData: null, metadataHash: '' },
        { deviceMake: null, deviceModel: null, capturedAt: null, metadataHash: '' }
      );
      expect(score).toBe(0);
    });
  });
});
