/**
 * A re-encoded video uploaded to another account must be blocked.
 *
 * Re-encoding rewrites every byte and strips the container tail, so exact-hash, TEP
 * and embedded-identity all miss it. Three of the six detectors are image-gated, so
 * before this detector existed a stolen video was caught by NOTHING and was minted a
 * fresh identity and certificate under the thief's account.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    dnaRecord: { findFirst: jest.fn(), findUnique: jest.fn() },
    cryptoLayer: { findFirst: jest.fn() },
    perceptualLayer: { findMany: jest.fn() },
    asset: { findMany: jest.fn() },
    duplicateAttempt: { create: jest.fn() },
    user: { findUnique: jest.fn(async () => ({ shortId: 'PINIT-UPLOADER' })) },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/audit/audit.service', () => ({
  auditService: { log: jest.fn(async () => undefined) },
}));

jest.mock('../../src/services/identity/identity-embedding.service', () => ({
  identityEmbeddingService: { extractAndVerify: jest.fn(async () => ({ verified: false })) },
}));

jest.mock('../../src/services/tep/tep.service', () => ({
  tepService: { extractFromFile: jest.fn(async () => ({ found: false })) },
}));

jest.mock('../../src/services/duplicate/pinit-signature-detector.service', () => ({
  pinitSignatureDetector: { detect: jest.fn(async () => ({ detected: false })) },
}));

jest.mock('../../src/services/assets/video-asset-dna.service', () => ({
  buildVideoAssetDna: jest.fn(),
}));

import { prisma } from '../../src/lib/prisma';
import { DuplicateCheckService } from '../../src/services/duplicate/duplicate-check.service';
import { buildVideoAssetDna } from '../../src/services/assets/video-asset-dna.service';

const dnaFindFirst = prisma.dnaRecord.findFirst as unknown as jest.Mock<AnyAsync>;
const dnaFindUnique = prisma.dnaRecord.findUnique as unknown as jest.Mock<AnyAsync>;
const cryptoFindFirst = prisma.cryptoLayer.findFirst as unknown as jest.Mock<AnyAsync>;
const assetFindMany = prisma.asset.findMany as unknown as jest.Mock<AnyAsync>;
const videoDna = buildVideoAssetDna as unknown as jest.Mock<AnyAsync>;

const UPLOADER = 'user-a';
const OTHER = 'user-b';
const req = () => ({ user: { sub: UPLOADER }, headers: {}, ip: '1.2.3.4' } as never);

const FRAMES = ['ffffffffffffffff', '0000000000000000', 'aaaaaaaaaaaaaaaa', '5555555555555555'];

/** What a lossy re-encode does to the hashes: a low-bit flip per frame. */
const REENCODED = FRAMES.map((h) => h.slice(0, 15) + (parseInt(h[15]!, 16) ^ 1).toString(16));

const ownedBy = (ownerUserId: string | null) => ({
  id: 'dna-video-1',
  imageFilename: 'Coffee.mp4',
  createdAt: new Date(),
  ownerUserId,
  ownerUser: ownerUserId ? { shortId: 'PINIT-OTHER' } : null,
});

let service: DuplicateCheckService;

beforeEach(() => {
  dnaFindFirst.mockReset();
  dnaFindUnique.mockReset();
  cryptoFindFirst.mockReset();
  assetFindMany.mockReset();
  videoDna.mockReset();

  dnaFindFirst.mockResolvedValue(null);   // no exact hash match
  cryptoFindFirst.mockResolvedValue(null);
  assetFindMany.mockResolvedValue([{ dnaId: 'dna-video-1', fingerprints: { framePHashes: FRAMES } }]);
  videoDna.mockResolvedValue({ framePHashes: REENCODED, ffmpegAvailable: true });
  dnaFindUnique.mockResolvedValue(ownedBy(OTHER));

  service = new DuplicateCheckService();
});

const uploadVideo = () =>
  service.check(Buffer.from('re-encoded bytes'), 'video/mp4', 'stolen.mp4', req());

describe('video keyframe duplicate detection', () => {
  test('a re-encoded video from another account is BLOCKED', async () => {
    const result = await uploadVideo();

    expect(result.isDuplicate).toBe(true);
    expect(result.matchType).toBe('NEAR_DUPLICATE_VIDEO_FRAMES');
    expect(result.ownerShortId).toBe('PINIT-OTHER');
  });

  test('the same account may re-protect its own video', async () => {
    dnaFindUnique.mockResolvedValue(ownedBy(UPLOADER));

    expect((await uploadVideo()).isDuplicate).toBe(false);
  });

  test('an unowned candidate never blocks', async () => {
    // Inherits the O6 rule through the shared finalize path.
    dnaFindUnique.mockResolvedValue(ownedBy(null));

    expect((await uploadVideo()).isDuplicate).toBe(false);
  });

  test('a genuinely different video is allowed', async () => {
    // Each of these sits exactly 2 bits per nibble (0.5 similarity) from every
    // stored frame, so none can clear the 0.68 strong-match threshold.
    videoDna.mockResolvedValue({
      framePHashes: ['cccccccccccccccc', '3333333333333333', '9999999999999999', '6666666666666666'],
      ffmpegAvailable: true,
    });

    expect((await uploadVideo()).isDuplicate).toBe(false);
  });

  test('no ffmpeg means no guess — the upload is allowed through', async () => {
    // Guessing from container bytes here would refuse people their own uploads.
    videoDna.mockResolvedValue({ framePHashes: [], ffmpegAvailable: false });

    expect((await uploadVideo()).isDuplicate).toBe(false);
  });

  test('candidates are scoped to owned videos that have fingerprints', async () => {
    await uploadVideo();

    const where = (assetFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.assetType).toBe('VIDEO');
    expect(where.dnaId).toEqual({ not: null });
    expect(where).toHaveProperty('fingerprints');
  });

  test('an image upload never runs the video detector', async () => {
    await service.check(Buffer.from('png bytes'), 'image/png', 'photo.png', req());

    expect(videoDna).not.toHaveBeenCalled();
    expect(assetFindMany).not.toHaveBeenCalled();
  });

  test('an exact byte match still wins before frame work is attempted', async () => {
    dnaFindFirst.mockResolvedValue(ownedBy(OTHER));

    const result = await uploadVideo();

    expect(result.matchType).toBe('EXACT_HASH');
    expect(videoDna).not.toHaveBeenCalled(); // no wasted ffmpeg decode
  });
});
