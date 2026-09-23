/**
 * DNA-B (the pixel watermark) corroborates a match pHash/ORB already made —
 * it never creates one on its own. A verified HMAC hit on an existing
 * candidate forces isHighRisk; it can never flip isDuplicate from false to
 * true by itself, and detectors that don't pass a probeBuffer (exact hash,
 * TEP, embedded identity, PINIT signature) are entirely unaffected.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    dnaRecord: { findFirst: jest.fn(), findUnique: jest.fn() },
    cryptoLayer: { findFirst: jest.fn() },
    perceptualLayer: { findMany: jest.fn() },
    localFeatureIndex: { findMany: jest.fn() },
    auditEvent: { findFirst: jest.fn(async () => null) },
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

jest.mock('../../src/services/dna-vnext/robust-watermark', () => ({
  recoverRobustProvenanceWatermark: jest.fn(),
}));

jest.mock('../../src/services/forensics/forensic-provenance.service', () => ({
  forensicProvenanceService: { append: jest.fn(async () => 'event-id') },
}));

import { prisma } from '../../src/lib/prisma';
import { DuplicateCheckService } from '../../src/services/duplicate/duplicate-check.service';
import { aiService } from '../../src/services/ai/ai-embeddings.service';
import { recoverRobustProvenanceWatermark } from '../../src/services/dna-vnext/robust-watermark';
import { forensicProvenanceService } from '../../src/services/forensics/forensic-provenance.service';

const dnaFindFirst = prisma.dnaRecord.findFirst as unknown as jest.Mock<AnyAsync>;
const dnaFindUnique = prisma.dnaRecord.findUnique as unknown as jest.Mock<AnyAsync>;
const cryptoFindFirst = prisma.cryptoLayer.findFirst as unknown as jest.Mock<AnyAsync>;
const perceptualFindMany = prisma.perceptualLayer.findMany as unknown as jest.Mock<AnyAsync>;
const localFeatureFindMany = prisma.localFeatureIndex.findMany as unknown as jest.Mock<AnyAsync>;
const extractLocalDnaIndex = aiService.extractLocalDnaIndex as unknown as jest.Mock<AnyAsync>;
const matchDescriptorSets = aiService.matchDescriptorSets as unknown as jest.Mock<AnyAsync>;
const recoverDnaB = recoverRobustProvenanceWatermark as unknown as jest.Mock<AnyAsync>;
const provenanceAppend = forensicProvenanceService.append as unknown as jest.Mock<AnyAsync>;

const UPLOADER = 'user-a';
const OTHER = 'user-b';
const req = () => ({ user: { sub: UPLOADER }, headers: {}, ip: '1.2.3.4' } as never);
// Anonymous (no auth) uploader: _isCrossUserUpload returns false when
// uploaderUserId is undefined, and _isHighRisk's own IP-heat check is mocked
// to false too — an otherwise-false baseline that isolates DNA-B's own
// contribution, since a logged-in cross-account uploader already always
// forces isHighRisk via the existing heuristic regardless of DNA-B.
const anonReq = () => ({ headers: {}, ip: '1.2.3.4' } as never);

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
  recoverDnaB.mockReset();
  provenanceAppend.mockReset();
  provenanceAppend.mockResolvedValue('event-id');

  dnaFindFirst.mockResolvedValue(null);
  cryptoFindFirst.mockResolvedValue(null);
  perceptualFindMany.mockResolvedValue([]);
  extractLocalDnaIndex.mockResolvedValue(PROBE_DESCRIPTORS);
  localFeatureFindMany.mockResolvedValue(ONE_CANDIDATE);
  dnaFindUnique.mockResolvedValue(ownedBy(OTHER));
  matchDescriptorSets.mockResolvedValue({ similarity: 0.95, matches: 400, method: 'opencv_orb' });
  recoverDnaB.mockResolvedValue({ recovered: false });

  service = new DuplicateCheckService();
});

const uploadImage = (r = req()) =>
  service.check(Buffer.from('cropped jpeg bytes'), 'image/jpeg', 'cropped.jpg', r);

describe('DNA-B corroboration on an ORB match', () => {
  test('a verified DNA-B hit raises isHighRisk on an otherwise-not-high-risk match', async () => {
    // Anonymous uploader + no IP-heat signal => isHighRisk would be FALSE
    // without DNA-B. This is the case that actually proves the new code
    // does something — a logged-in cross-account uploader already always
    // forces isHighRisk via the existing heuristic regardless of DNA-B.
    recoverDnaB.mockResolvedValue({ recovered: false });
    const baseline = await uploadImage(anonReq());
    expect(baseline.isDuplicate).toBe(true);
    expect(baseline.isHighRisk).toBe(false);

    recoverDnaB.mockResolvedValue({ recovered: true, dnaRecordId: 'dna-orb-1' });
    const withDnaB = await uploadImage(anonReq());

    expect(withDnaB.isDuplicate).toBe(true);
    expect(withDnaB.isHighRisk).toBe(true);
    expect(recoverDnaB).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: OTHER }),
    );
  });

  test('no DNA-B recovery does not prevent the ORB match itself from blocking', async () => {
    recoverDnaB.mockResolvedValue({ recovered: false });

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(true);
    expect(result.matchType).toBe('NEAR_DUPLICATE_ORB_FEATURES');
  });

  test('DNA-B recovering a DIFFERENT dnaRecordId than the match does not corroborate', async () => {
    // Guards against ever trusting a stray/mismatched lookup as proof of
    // THIS match specifically — must not raise isHighRisk on a mismatch.
    recoverDnaB.mockResolvedValue({ recovered: true, dnaRecordId: 'some-other-record' });

    const result = await uploadImage(anonReq());

    expect(result.isDuplicate).toBe(true);
    expect(result.isHighRisk).toBe(false);
  });

  test('DNA-B is never consulted when there is no candidate at all', async () => {
    localFeatureFindMany.mockResolvedValue([]);

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(false);
    expect(recoverDnaB).not.toHaveBeenCalled();
  });

  test('DNA-B check failing (thrown error) does not block or crash the upload', async () => {
    recoverDnaB.mockRejectedValue(new Error('sharp decode failed'));

    const result = await uploadImage();

    // The underlying ORB match still stands — DNA-B corroboration is
    // additive and non-fatal, exactly like every other soft-fail detector.
    expect(result.isDuplicate).toBe(true);
  });

  test('same-account re-upload is allowed without ever consulting DNA-B', async () => {
    dnaFindUnique.mockResolvedValue(ownedBy(UPLOADER));

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(false);
    expect(recoverDnaB).not.toHaveBeenCalled();
  });

  test('an unowned candidate is allowed without ever consulting DNA-B (O6)', async () => {
    dnaFindUnique.mockResolvedValue(ownedBy(null));

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(false);
    expect(recoverDnaB).not.toHaveBeenCalled();
  });
});

describe('DNA-B is scoped to pHash/ORB only — other detectors are unaffected', () => {
  test('an exact-hash match never consults DNA-B', async () => {
    dnaFindFirst.mockResolvedValue(ownedBy(OTHER));

    const result = await uploadImage();

    expect(result.matchType).toBe('EXACT_HASH');
    expect(recoverDnaB).not.toHaveBeenCalled();
  });
});

describe('a block appends a real provenance event (mirrored into Layer 13 custody chain)', () => {
  test('a blocked ORB match records UNAUTHORIZED_REPRODUCTION_DETECTED', async () => {
    const result = await uploadImage();
    expect(result.isDuplicate).toBe(true);

    // The append is fire-and-forget (dynamic import inside an unawaited
    // IIFE) — flush the event loop so it's had a chance to run.
    await new Promise((r) => setTimeout(r, 0));

    expect(provenanceAppend).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'UNAUTHORIZED_REPRODUCTION_DETECTED', dnaRecordId: 'dna-orb-1' }),
    );
  });

  test('an allowed same-account re-upload never appends a provenance event', async () => {
    dnaFindUnique.mockResolvedValue(ownedBy(UPLOADER));

    const result = await uploadImage();
    expect(result.isDuplicate).toBe(false);

    await new Promise((r) => setTimeout(r, 0));
    expect(provenanceAppend).not.toHaveBeenCalled();
  });
});
