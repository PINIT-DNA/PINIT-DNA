/**
 * Compact frame DNA — frame identity and the video-wide Merkle chain.
 *
 * The whole point of storing one row per frame is that the row still proves the
 * frame. That rests on three properties tested here: a leaf commits to the pixels,
 * the pixel-cell root AND the patch grid; the chain changes if any frame changes;
 * and a frame's key material is bound to its position, so frames cannot be swapped.
 */
import { describe, test, expect } from '@jest/globals';
import {
  frameLeafHash,
  frameMerkleRoot,
  frameHkcaIdentity,
} from '../../src/services/videos/frame-dna/video-frame-dna.service';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const ROOT_A = 'c'.repeat(64);
const PACK = Buffer.from('PFP1 patch grid bytes');

describe('frame leaf hash', () => {
  test('is stable for the same frame', () => {
    const leaf = frameLeafHash({ frameIndex: 7, rgbSha256: SHA_A, hkcaRoot: ROOT_A, patchPack: PACK });
    expect(leaf).toBe(frameLeafHash({ frameIndex: 7, rgbSha256: SHA_A, hkcaRoot: ROOT_A, patchPack: PACK }));
    expect(leaf).toMatch(/^[0-9a-f]{64}$/);
  });

  test('changes when the pixels, the pixel-cell root, the patches or the position change', () => {
    const base = frameLeafHash({ frameIndex: 7, rgbSha256: SHA_A, hkcaRoot: ROOT_A, patchPack: PACK });

    expect(frameLeafHash({ frameIndex: 7, rgbSha256: SHA_B, hkcaRoot: ROOT_A, patchPack: PACK })).not.toBe(base);
    expect(frameLeafHash({ frameIndex: 7, rgbSha256: SHA_A, hkcaRoot: SHA_B, patchPack: PACK })).not.toBe(base);
    expect(frameLeafHash({ frameIndex: 7, rgbSha256: SHA_A, hkcaRoot: ROOT_A, patchPack: Buffer.from('other') })).not.toBe(base);
    expect(frameLeafHash({ frameIndex: 8, rgbSha256: SHA_A, hkcaRoot: ROOT_A, patchPack: PACK })).not.toBe(base);
  });

  test('a frame with pixel auth disabled still gets a distinct leaf', () => {
    const withoutHkca = frameLeafHash({ frameIndex: 1, rgbSha256: SHA_A, hkcaRoot: null, patchPack: PACK });
    expect(withoutHkca).toMatch(/^[0-9a-f]{64}$/);
    expect(withoutHkca).not.toBe(frameLeafHash({ frameIndex: 1, rgbSha256: SHA_A, hkcaRoot: ROOT_A, patchPack: PACK }));
  });
});

describe('video frame Merkle chain', () => {
  const leaves = Array.from({ length: 4919 }, (_, i) =>
    frameLeafHash({ frameIndex: i, rgbSha256: SHA_A, hkcaRoot: ROOT_A, patchPack: PACK }));

  test('one root commits to every frame of a full-length video', () => {
    const root = frameMerkleRoot(leaves);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
    expect(frameMerkleRoot(leaves)).toBe(root);
  });

  test('changing a single frame anywhere changes the root', () => {
    const root = frameMerkleRoot(leaves);

    for (const index of [0, 2460, leaves.length - 1]) {
      const tampered = [...leaves];
      tampered[index] = frameLeafHash({ frameIndex: index, rgbSha256: SHA_B, hkcaRoot: ROOT_A, patchPack: PACK });
      expect(frameMerkleRoot(tampered)).not.toBe(root);
    }
  });

  test('dropping or reordering frames changes the root', () => {
    const root = frameMerkleRoot(leaves);
    expect(frameMerkleRoot(leaves.slice(0, -1))).not.toBe(root);

    const swapped = [...leaves];
    [swapped[10], swapped[11]] = [swapped[11]!, swapped[10]!];
    expect(frameMerkleRoot(swapped)).not.toBe(root);
  });

  test('no frames means no root, rather than a root over nothing', () => {
    expect(frameMerkleRoot([])).toBeNull();
  });
});

describe('frame pixel-auth key material', () => {
  test('is bound to the video, the frame position and the frame content', () => {
    const a = frameHkcaIdentity('video-1', 10, SHA_A);
    const b = frameHkcaIdentity('video-1', 11, SHA_A);
    const c = frameHkcaIdentity('video-2', 10, SHA_A);
    const d = frameHkcaIdentity('video-1', 10, SHA_B);

    // Different frame positions derive different keys, so a tag lifted from one
    // frame can never verify another — a reordered or spliced video fails.
    expect(a.dnaRecordId).not.toBe(b.dnaRecordId);
    expect(a.dnaRecordId).not.toBe(c.dnaRecordId);
    expect(a.globalDnaRef).not.toBe(b.globalDnaRef);
    expect(a.globalDnaRef).not.toBe(d.globalDnaRef);
    expect(a.globalDnaRef).toContain(SHA_A);
  });
});
