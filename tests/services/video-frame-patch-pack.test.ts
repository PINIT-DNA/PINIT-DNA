/**
 * Compact video frame DNA — patch pack (PFP1) must be lossless.
 *
 * The matchers compare exact hex strings and color vectors, so a pack that rounds,
 * truncates or reorders anything would silently weaken crop/fragment detection.
 */
import { describe, test, expect } from '@jest/globals';
import {
  encodePatchPack,
  decodePatchPack,
  PATCH_PACK_BYTES_PER_PATCH,
} from '../../src/services/videos/frame-dna/patch-pack';
import type { PatchFingerprint } from '../../src/services/forensics/local-dna-patch-generator.service';

function patch(i: number, over: Partial<PatchFingerprint> = {}): PatchFingerprint {
  return {
    patchIndex: i,
    gridX: i % 158,
    gridY: Math.floor(i / 158),
    scale: [16, 32, 64, 128, 256, 512][i % 6]!,
    pHash16: (0x0123456789abcdefn ^ BigInt(i)).toString(16).padStart(16, '0'),
    dHash8: (i * 2654435761 >>> 0).toString(16).padStart(8, '0'),
    aHash8: 'ffffffff',
    edgeSignature: (i % 256).toString(16).padStart(2, '0'),
    frequencySig: '00',
    textureSig: 'ff',
    colorVector: [i % 256, 255, 0],
    ...over,
  };
}

describe('video frame patch pack (PFP1)', () => {
  test('round-trips a full 2,465-patch frame exactly', () => {
    const patches = Array.from({ length: 2465 }, (_, i) => patch(i));
    const blob = encodePatchPack(patches);

    expect(blob.length).toBe(8 + 2465 * PATCH_PACK_BYTES_PER_PATCH);
    expect(decodePatchPack(blob)).toEqual(patches);
  });

  test('is ~7x smaller than the 203-byte LocalDnaPatch row it replaces', () => {
    const blob = encodePatchPack(Array.from({ length: 2465 }, (_, i) => patch(i)));
    expect(blob.length / 2465).toBeLessThan(203 / 6);
  });

  test('round-trips an empty grid', () => {
    expect(decodePatchPack(encodePatchPack([]))).toEqual([]);
  });

  test('refuses values it cannot store losslessly', () => {
    expect(() => encodePatchPack([patch(0, { gridX: 70000 })])).toThrow(/gridX/);
    expect(() => encodePatchPack([patch(0, { pHash16: 'ABC' })])).toThrow(/pHash16/);
    expect(() => encodePatchPack([patch(0, { colorVector: [256, 0, 0] })])).toThrow(/colorVector/);
    expect(() => encodePatchPack([patch(0, { colorVector: [1.5, 0, 0] })])).toThrow(/colorVector/);
  });

  test('rejects truncated, padded and foreign blobs', () => {
    const blob = encodePatchPack([patch(0), patch(1)]);
    expect(() => decodePatchPack(blob.subarray(0, blob.length - 1))).toThrow(/length/);
    expect(() => decodePatchPack(Buffer.concat([blob, Buffer.from([0])]))).toThrow(/length/);
    expect(() => decodePatchPack(Buffer.from('NOPE0000'))).toThrow(/PFP1/);
  });
});
