/**
 * Without ffmpeg there are no decoded frames, so there are no perceptual hashes.
 *
 * The fallback used to substitute container-byte SHA slices for `framePHashes`.
 * Those are 16-hex, exactly like a real Block-Mean-Hash-64, so every downstream
 * hamming comparator accepted them and compared meaningless bits as though they
 * described pictures.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/forensics/media-tools.service', () => ({
  isFfmpegAvailable: jest.fn(async () => false),
  extractVideoFrameSamples: jest.fn(async () => []),
  extractAudioSample: jest.fn(async () => null),
  probeVideoFps: jest.fn(async () => null),
}));

import {
  generateInvestigationVideoDna,
  verifyVideoDna,
  compareVideoFrameHashes,
} from '../../src/services/forensics/video-dna-enhancements.service';
import { isFfmpegAvailable } from '../../src/services/forensics/media-tools.service';

const ffmpegAvailable = isFfmpegAvailable as unknown as jest.Mock<AnyAsync>;

beforeEach(() => {
  ffmpegAvailable.mockReset();
  ffmpegAvailable.mockResolvedValue(false);
});

describe('video DNA — no ffmpeg', () => {
  test('framePHashes is empty, NOT container-byte SHA slices', async () => {
    const dna = await generateInvestigationVideoDna(Buffer.alloc(20000, 7));

    expect(dna.framePHashes).toEqual([]);
    // Keyframe hashes are still produced — they are a coarse identity signal and
    // are not claimed to be perceptual.
    expect(dna.keyframeHashes?.length ?? 0).toBeGreaterThan(0);
    expect(dna.framePHashes).not.toEqual(dna.keyframeHashes);
  });

  test('the fallback path is recorded in algorithmVersion', async () => {
    const dna = await generateInvestigationVideoDna(Buffer.alloc(20000, 7));

    expect(dna.ffmpegAvailable).toBe(false);
    expect(dna.algorithmVersion).toBe('2.2-binary-fallback');
  });

  test('verifyVideoDna tolerates the empty array', async () => {
    const dna = await generateInvestigationVideoDna(Buffer.alloc(20000, 7));

    expect(() => verifyVideoDna(dna, dna)).not.toThrow();
    expect(verifyVideoDna(dna, dna)).toBeGreaterThan(0); // keyframes still score
  });

  test('a fallback record can never match on frames', async () => {
    const dna = await generateInvestigationVideoDna(Buffer.alloc(20000, 7));

    // Even against itself — no frame hashes means no frame evidence.
    expect(compareVideoFrameHashes(dna.framePHashes, dna.framePHashes).similarity).toBe(0);
  });
});

describe('compareVideoFrameHashes', () => {
  const A = ['ffffffffffffffff', '0000000000000000', 'aaaaaaaaaaaaaaaa', '5555555555555555'];

  test('identical frame sets score 1.0', () => {
    const r = compareVideoFrameHashes(A, A);
    expect(r.similarity).toBe(1);
    expect(r.strongMatches).toBe(4);
    expect(r.comparedFrames).toBe(4);
  });

  test('a transcode-like perturbation still clears the threshold', () => {
    // Flip one nibble's low bit in each hash — what lossy re-encoding looks like.
    const perturbed = A.map((h) => h.slice(0, 15) + (parseInt(h[15]!, 16) ^ 1).toString(16));
    expect(compareVideoFrameHashes(perturbed, A).similarity).toBe(1);
  });

  test('unrelated frames score below the threshold', () => {
    const different = ['ffffffffffffffff', 'fffffffffffffffe', 'fffffffffffffffd', 'fffffffffffffffc'];
    // Only the all-ones probe frame can match; the rest are far from every stored hash.
    const r = compareVideoFrameHashes(different, ['0000000000000000', '0000000000000001']);
    expect(r.similarity).toBeLessThan(0.6);
  });

  test('a trimmed re-upload still scores on the frames it has', () => {
    // Asymmetric: 2 probe frames, both present in a 4-frame original.
    const r = compareVideoFrameHashes([A[0]!, A[2]!], A);
    expect(r.similarity).toBe(1);
    expect(r.comparedFrames).toBe(2);
  });

  test('an empty side never matches', () => {
    expect(compareVideoFrameHashes([], A).similarity).toBe(0);
    expect(compareVideoFrameHashes(A, []).similarity).toBe(0);
    expect(compareVideoFrameHashes(undefined, A).similarity).toBe(0);
    expect(compareVideoFrameHashes(A, null).similarity).toBe(0);
  });

  test('mismatched hash lengths are skipped, not scored as a match', () => {
    expect(compareVideoFrameHashes(['ffff'], A).similarity).toBe(0);
  });
});
