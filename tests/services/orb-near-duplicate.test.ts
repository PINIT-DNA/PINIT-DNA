/**
 * A cropped-then-reuploaded image must still be blocked.
 *
 * pHash collapses under a meaningful crop (a 40% crop already drops it below its
 * own 0.9 threshold — see perceptual-robustness.test.ts). ORB keypoints inside
 * the surviving region still match, so this detector compares against descriptors
 * already stored at protect time (LocalFeatureIndex.orbDescriptors) — no vault
 * decrypt, no buffer refetch, no re-running ORB on the original.
 *
 * The probe's own descriptors are extracted ONCE (extractLocalDnaIndex) and
 * matched against each candidate via the lean matchDescriptorSets call — not
 * matchLocalDescriptors, which would redo the probe's ORB extraction on every
 * one of up to ORB_SCAN_LIMIT candidates (a real, measured multi-second cost
 * per upload before this was fixed).
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    dnaRecord: { findFirst: jest.fn(), findUnique: jest.fn() },
    cryptoLayer: { findFirst: jest.fn() },
    perceptualLayer: { findMany: jest.fn() },
    localFeatureIndex: { findMany: jest.fn() },
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

jest.mock('../../src/services/ai/ai-embeddings.service', () => ({
  aiService: { extractLocalDnaIndex: jest.fn(), matchDescriptorSets: jest.fn() },
}));

jest.mock('../../src/services/assets/video-asset-dna.service', () => ({
  buildVideoAssetDna: jest.fn(async () => ({ framePHashes: [], ffmpegAvailable: false })),
}));

import { prisma } from '../../src/lib/prisma';
import { DuplicateCheckService } from '../../src/services/duplicate/duplicate-check.service';
import { aiService } from '../../src/services/ai/ai-embeddings.service';

const dnaFindFirst = prisma.dnaRecord.findFirst as unknown as jest.Mock<AnyAsync>;
const dnaFindUnique = prisma.dnaRecord.findUnique as unknown as jest.Mock<AnyAsync>;
const cryptoFindFirst = prisma.cryptoLayer.findFirst as unknown as jest.Mock<AnyAsync>;
const perceptualFindMany = prisma.perceptualLayer.findMany as unknown as jest.Mock<AnyAsync>;
const localFeatureFindMany = prisma.localFeatureIndex.findMany as unknown as jest.Mock<AnyAsync>;
const extractLocalDnaIndex = aiService.extractLocalDnaIndex as unknown as jest.Mock<AnyAsync>;
const matchDescriptorSets = aiService.matchDescriptorSets as unknown as jest.Mock<AnyAsync>;

const UPLOADER = 'user-a';
const OTHER = 'user-b';
const req = () => ({ user: { sub: UPLOADER }, headers: {}, ip: '1.2.3.4' } as never);

const ownedBy = (ownerUserId: string | null) => ({
  id: 'dna-orb-1',
  imageFilename: 'protected.jpg',
  createdAt: new Date(),
  ownerUserId,
  ownerUser: ownerUserId ? { shortId: 'PINIT-OTHER' } : null,
});

const ONE_CANDIDATE = [{ dnaRecordId: 'dna-orb-1', orbDescriptors: { keypoints: [] } }];
const PROBE_DESCRIPTORS = { orbKeypoints: 900, orbDescriptors: { keypoints: [{ x: 1 }] } };

let service: DuplicateCheckService;

beforeEach(() => {
  dnaFindFirst.mockReset();
  dnaFindUnique.mockReset();
  cryptoFindFirst.mockReset();
  perceptualFindMany.mockReset();
  localFeatureFindMany.mockReset();
  extractLocalDnaIndex.mockReset();
  matchDescriptorSets.mockReset();

  dnaFindFirst.mockResolvedValue(null);         // no exact-hash match
  cryptoFindFirst.mockResolvedValue(null);
  perceptualFindMany.mockResolvedValue([]);     // no pHash match — this is the crop case
  extractLocalDnaIndex.mockResolvedValue(PROBE_DESCRIPTORS);
  localFeatureFindMany.mockResolvedValue(ONE_CANDIDATE);
  dnaFindUnique.mockResolvedValue(ownedBy(OTHER));

  service = new DuplicateCheckService();
});

const uploadImage = () =>
  service.check(Buffer.from('cropped jpeg bytes'), 'image/jpeg', 'cropped.jpg', req());

describe('ORB near-duplicate detection', () => {
  test('the probe is extracted once, then matched per candidate via matchDescriptorSets', async () => {
    matchDescriptorSets.mockResolvedValue({ similarity: 0.95, matches: 400, method: 'opencv_orb' });

    await uploadImage();

    expect(extractLocalDnaIndex).toHaveBeenCalledTimes(1);
    expect(matchDescriptorSets).toHaveBeenCalledWith(
      PROBE_DESCRIPTORS.orbDescriptors,
      ONE_CANDIDATE[0]!.orbDescriptors,
    );
  });

  test('identical descriptor sets are blocked cross-account', async () => {
    matchDescriptorSets.mockResolvedValue({ similarity: 0.95, matches: 400, method: 'opencv_orb' });

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(true);
    expect(result.matchType).toBe('NEAR_DUPLICATE_ORB_FEATURES');
    expect(result.ownerShortId).toBe('PINIT-OTHER');
  });

  test('a simulated crop (moderate similarity) still blocks', async () => {
    // Most keypoints outside the crop region are gone; the ones inside still
    // match — mock-level stand-in for a real pixel-level crop (see plan's
    // Verification section for the real-image end-to-end check).
    matchDescriptorSets.mockResolvedValue({ similarity: 0.55, matches: 80, method: 'opencv_orb' });

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(true);
  });

  test('an unrelated image scores below threshold — no match', async () => {
    matchDescriptorSets.mockResolvedValue({ similarity: 0.10, matches: 3, method: 'opencv_orb' });

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(false);
  });

  test('AI service offline (null) never matches, never blocks', async () => {
    matchDescriptorSets.mockResolvedValue(null);

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(false);
  });

  test('probe extraction failing means the upload is never screened — allowed, not guessed', async () => {
    extractLocalDnaIndex.mockResolvedValue(null);

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(false);
    expect(localFeatureFindMany).not.toHaveBeenCalled();
    expect(matchDescriptorSets).not.toHaveBeenCalled();
  });

  test('no candidates with descriptors — detector returns immediately, no AI match call', async () => {
    localFeatureFindMany.mockResolvedValue([]);

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(false);
    expect(matchDescriptorSets).not.toHaveBeenCalled();
  });

  test('the same account may still re-protect its own file', async () => {
    matchDescriptorSets.mockResolvedValue({ similarity: 0.95, matches: 400, method: 'opencv_orb' });
    dnaFindUnique.mockResolvedValue(ownedBy(UPLOADER));

    expect((await uploadImage()).isDuplicate).toBe(false);
  });

  test('an unowned candidate never blocks (O6)', async () => {
    matchDescriptorSets.mockResolvedValue({ similarity: 0.95, matches: 400, method: 'opencv_orb' });
    dnaFindUnique.mockResolvedValue(ownedBy(null));

    expect((await uploadImage()).isDuplicate).toBe(false);
  });

  test('the candidate query excludes unowned records and unfinished indexes', async () => {
    matchDescriptorSets.mockResolvedValue({ similarity: 0.95, matches: 400, method: 'opencv_orb' });

    await uploadImage();

    const where = (localFeatureFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.status).toBe('COMPLETE');
    expect(where.dnaRecord).toEqual({ is: { ownerUserId: { not: null } } });
    expect(where).toHaveProperty('orbDescriptors');
  });

  test('a video upload never runs the ORB detector', async () => {
    await service.check(Buffer.from('mp4 bytes'), 'video/mp4', 'clip.mp4', req());

    expect(extractLocalDnaIndex).not.toHaveBeenCalled();
    expect(localFeatureFindMany).not.toHaveBeenCalled();
  });

  test('an exact byte match still wins before ORB work is attempted', async () => {
    dnaFindFirst.mockResolvedValue(ownedBy(OTHER));

    const result = await uploadImage();

    expect(result.matchType).toBe('EXACT_HASH');
    expect(extractLocalDnaIndex).not.toHaveBeenCalled();
    expect(localFeatureFindMany).not.toHaveBeenCalled();
  });
});
