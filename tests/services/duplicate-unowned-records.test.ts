/**
 * O6 — a record with no owner must never block an upload.
 *
 * Verification probes and other internal artifacts are written without an
 * ownerUserId. Because `_isSameAccount(null, uploader)` is false, they used to
 * fall through to the cross-account branch, so a real owner was refused their own
 * file and told it belonged to an account that could not be named.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    dnaRecord: { findFirst: jest.fn(), findUnique: jest.fn() },
    cryptoLayer: { findFirst: jest.fn() },
    perceptualLayer: { findMany: jest.fn() },
    duplicateAttempt: { create: jest.fn() },
    // The blocking path logs the attempt and resolves the uploader's shortId.
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
  tepService: { lookupByBytes: jest.fn(async () => null), markRediscovered: jest.fn() },
}));

jest.mock('../../src/services/duplicate/pinit-signature-detector.service', () => ({
  pinitSignatureDetector: { detect: jest.fn(async () => ({ detected: false })) },
}));

import { prisma } from '../../src/lib/prisma';
import { DuplicateCheckService } from '../../src/services/duplicate/duplicate-check.service';

const dnaFindFirst = prisma.dnaRecord.findFirst as unknown as jest.Mock<AnyAsync>;
const cryptoFindFirst = prisma.cryptoLayer.findFirst as unknown as jest.Mock<AnyAsync>;
const perceptualFindMany = prisma.perceptualLayer.findMany as unknown as jest.Mock<AnyAsync>;

const UPLOADER = 'user-a';
const req = () => ({ user: { sub: UPLOADER }, headers: {}, ip: '1.2.3.4' } as never);

const OWNED_BY_SOMEONE_ELSE = {
  id: 'dna-owned',
  imageFilename: 'their-photo.jpg',
  createdAt: new Date(),
  imageMimeType: 'image/jpeg',
  ownerUserId: 'user-b',
  ownerUser: { shortId: 'PINIT-OTHER' },
};

const UNOWNED_PROBE = {
  id: 'dna-probe',
  imageFilename: '[probe] The beach (1).jpg',
  createdAt: new Date(),
  imageMimeType: 'image/jpeg',
  ownerUserId: null,
  ownerUser: null,
};

let service: DuplicateCheckService;

beforeEach(() => {
  dnaFindFirst.mockReset();
  cryptoFindFirst.mockReset();
  perceptualFindMany.mockReset();
  cryptoFindFirst.mockResolvedValue(null);
  perceptualFindMany.mockResolvedValue([]);
  service = new DuplicateCheckService();
});

describe('duplicate check — unowned records', () => {
  test('an exact-hash match on an unowned probe does NOT block', async () => {
    dnaFindFirst.mockResolvedValueOnce(UNOWNED_PROBE);

    const result = await service.check(Buffer.from('bytes'), 'image/jpeg', 'The beach.jpg', req());

    expect(result.isDuplicate).toBe(false);
    expect(result.isHighRisk).toBe(false);
  });

  test('a genuine cross-account match still blocks and names the owner', async () => {
    dnaFindFirst.mockResolvedValueOnce(OWNED_BY_SOMEONE_ELSE);

    const result = await service.check(Buffer.from('bytes'), 'image/jpeg', 'photo.jpg', req());

    expect(result.isDuplicate).toBe(true);
    expect(result.ownerShortId).toBe('PINIT-OTHER');
    expect(result.matchType).toBe('EXACT_HASH');
  });

  test('the same account may still re-protect its own file', async () => {
    dnaFindFirst.mockResolvedValueOnce({
      ...OWNED_BY_SOMEONE_ELSE, ownerUserId: UPLOADER,
    });

    const result = await service.check(Buffer.from('bytes'), 'image/jpeg', 'mine.jpg', req());

    expect(result.isDuplicate).toBe(false);
  });

  test('unowned records are excluded from the candidate query itself', async () => {
    dnaFindFirst.mockResolvedValueOnce(null);

    await service.check(Buffer.from('bytes'), 'image/jpeg', 'x.jpg', req());

    const where = (dnaFindFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.ownerUserId).toEqual({ not: null });
  });

  test('the pHash scan pool excludes unowned records', async () => {
    dnaFindFirst.mockResolvedValueOnce(null);

    await service.check(Buffer.from('bytes'), 'image/jpeg', 'x.jpg', req());

    if (perceptualFindMany.mock.calls.length) {
      const arg = perceptualFindMany.mock.calls[0][0] as { where?: Record<string, unknown> };
      expect(arg.where).toEqual({ dnaRecord: { is: { ownerUserId: { not: null } } } });
    }
  });
});
