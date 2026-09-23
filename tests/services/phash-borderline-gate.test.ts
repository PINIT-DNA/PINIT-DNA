/**
 * Same multi-layer agreement gate as the ORB detector (see
 * orb-near-duplicate.test.ts), applied to pHash: above PHASH_STRONG_THRESHOLD
 * a match blocks alone as always; between PHASH_NEAR_DUPLICATE_THRESHOLD and
 * PHASH_STRONG_THRESHOLD ("borderline") it needs DNA-B to confirm first.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    dnaRecord: { findFirst: jest.fn(), findUnique: jest.fn() },
    cryptoLayer: { findFirst: jest.fn() },
    perceptualLayer: { findMany: jest.fn() },
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

jest.mock('../../src/services/dna-vnext/robust-watermark', () => ({
  recoverRobustProvenanceWatermark: jest.fn(async () => ({ recovered: false })),
}));

import { prisma } from '../../src/lib/prisma';
import { DuplicateCheckService } from '../../src/services/duplicate/duplicate-check.service';
import { PerceptualLayer } from '../../src/services/layers/layer3.perceptual';
import { recoverRobustProvenanceWatermark } from '../../src/services/dna-vnext/robust-watermark';

const dnaFindFirst = prisma.dnaRecord.findFirst as unknown as jest.Mock<AnyAsync>;
const dnaFindUnique = prisma.dnaRecord.findUnique as unknown as jest.Mock<AnyAsync>;
const cryptoFindFirst = prisma.cryptoLayer.findFirst as unknown as jest.Mock<AnyAsync>;
const perceptualFindMany = prisma.perceptualLayer.findMany as unknown as jest.Mock<AnyAsync>;
const recoverDnaB = recoverRobustProvenanceWatermark as unknown as jest.Mock<AnyAsync>;

const UPLOADER = 'user-a';
const OTHER = 'user-b';
const req = () => ({ user: { sub: UPLOADER }, headers: {}, ip: '1.2.3.4' } as never);

const ownedBy = (ownerUserId: string | null) => ({
  id: 'dna-phash-1',
  imageFilename: 'protected.jpg',
  createdAt: new Date(),
  ownerUserId,
  ownerUser: ownerUserId ? { shortId: 'PINIT-OTHER' } : null,
});

let service: DuplicateCheckService;
let verifySpy: jest.SpiedFunction<PerceptualLayer['verify']>;
let computeSpy: jest.SpiedFunction<PerceptualLayer['computeFingerprints']>;

beforeEach(() => {
  dnaFindFirst.mockReset();
  dnaFindUnique.mockReset();
  cryptoFindFirst.mockReset();
  perceptualFindMany.mockReset();
  recoverDnaB.mockReset();
  recoverDnaB.mockResolvedValue({ recovered: false });

  dnaFindFirst.mockResolvedValue(null);
  cryptoFindFirst.mockResolvedValue(null);
  perceptualFindMany.mockResolvedValue([{ pHash64: 'a', aHash64: 'a', dHash64: 'a', dnaRecordId: 'dna-phash-1' }]);
  dnaFindUnique.mockResolvedValue(ownedBy(OTHER));

  verifySpy?.mockRestore();
  verifySpy = jest.spyOn(PerceptualLayer.prototype, 'verify');
  computeSpy?.mockRestore();
  // Fake buffer isn't a real decodable image — computeFingerprints would
  // throw and get silently swallowed by the detector's own try/catch,
  // which would make these tests pass for the wrong reason (no match found
  // at all) regardless of what verify() returns. Stub it so verify() is
  // actually what's under test.
  computeSpy = jest.spyOn(PerceptualLayer.prototype, 'computeFingerprints')
    .mockResolvedValue({ pHash64: 'probe', aHash64: 'probe', dHash64: 'probe', pHash256: 'probe' } as never);

  service = new DuplicateCheckService();
});

const uploadImage = () =>
  service.check(Buffer.from('probe jpeg bytes'), 'image/jpeg', 'probe.jpg', req());

describe('pHash multi-layer agreement gate', () => {
  test('a borderline pHash match (0.91, below PHASH_STRONG_THRESHOLD=0.95) does NOT block alone', async () => {
    verifySpy.mockReturnValue(0.91);
    recoverDnaB.mockResolvedValue({ recovered: false });

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(false);
  });

  test('the SAME borderline pHash match DOES block once DNA-B corroborates it', async () => {
    verifySpy.mockReturnValue(0.91);
    recoverDnaB.mockResolvedValue({ recovered: true, dnaRecordId: 'dna-phash-1' });

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(true);
    expect(result.isHighRisk).toBe(true);
  });

  test('a strong pHash match (>= 0.95) still blocks alone, no DNA-B needed', async () => {
    verifySpy.mockReturnValue(0.97);
    recoverDnaB.mockResolvedValue({ recovered: false });

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(true);
    expect(result.matchType).toBe('NEAR_DUPLICATE_PHASH');
  });

  test('below the base threshold (0.85) never matches at all, corroboration is irrelevant', async () => {
    verifySpy.mockReturnValue(0.85);
    recoverDnaB.mockResolvedValue({ recovered: true, dnaRecordId: 'dna-phash-1' });

    const result = await uploadImage();

    expect(result.isDuplicate).toBe(false);
  });
});
