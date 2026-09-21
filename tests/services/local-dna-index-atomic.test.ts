/**
 * Building a local-DNA index must not be able to leave a COMPLETE index with no patches.
 *
 * The archive used to be written in a second step after the index row was marked
 * COMPLETE (and, on a rebuild, after the old patches were already deleted). A failure
 * in between stranded an index that claimed to be complete and matched nothing.
 *
 *  1. First build   — the index row and its archive are ONE write (nested create).
 *  2. Rebuild       — delete-old, delete-old-archive and replace happen inside ONE
 *                     transaction, so a failure leaves the previous index intact.
 *  3. Failure       — a failed write returns null (as before) and never reports success.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => {
  const p = {
    localFeatureIndex: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    localDnaPatch: { deleteMany: jest.fn(), createMany: jest.fn() },
    localDnaPatchArchive: { deleteMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  return { prisma: p };
});
jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/config/local-dna', () => ({ localDnaConfig: { enabled: true } }));
jest.mock('../../src/services/ai/ai-embeddings.service', () => ({
  aiService: { extractLocalDnaIndex: jest.fn(async () => null) },
}));
jest.mock('../../src/services/forensics/forensic-scanner.service', () => ({
  forensicScannerService: { indexVaultTiles: jest.fn(async () => undefined) },
}));
jest.mock('../../src/services/forensics/local-dna-patch-generator.service', () => ({
  localDnaPatchGenerator: {
    generateMultiScaleGrid: jest.fn(async () => ({
      imageWidth: 640, imageHeight: 480, patchSize: 32, gridCols: 20, gridRows: 15, scales: [32],
      globalPHash: 'a'.repeat(16),
      patches: Array.from({ length: 40 }, (_, i) => ({
        patchIndex: i, gridX: i % 20, gridY: Math.floor(i / 20), scale: 32,
        pHash16: '0123456789abcdef', dHash8: '01234567', aHash8: '89abcdef', edgeSignature: '0a',
        colorVector: [1, 2, 3], frequencySig: '0b', textureSig: '0c',
      })),
    })),
  },
}));

import { prisma } from '../../src/lib/prisma';
import { LocalDnaIndexService } from '../../src/services/forensics/local-dna-index.service';

const findUnique = prisma.localFeatureIndex.findUnique as unknown as jest.Mock<AnyAsync>;
const create = prisma.localFeatureIndex.create as unknown as jest.Mock<AnyAsync>;
const update = prisma.localFeatureIndex.update as unknown as jest.Mock<AnyAsync>;
const patchDeleteMany = prisma.localDnaPatch.deleteMany as unknown as jest.Mock<AnyAsync>;
const archiveDeleteMany = prisma.localDnaPatchArchive.deleteMany as unknown as jest.Mock<AnyAsync>;
const archiveCreate = prisma.localDnaPatchArchive.create as unknown as jest.Mock<AnyAsync>;
const transaction = prisma.$transaction as unknown as jest.Mock<AnyAsync>;

const params = { buffer: Buffer.from('img'), mimeType: 'image/png', dnaRecordId: 'dna-1', vaultId: 'vault-1', ownerUserId: 'owner-1' };
let service: LocalDnaIndexService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new LocalDnaIndexService();
  findUnique.mockResolvedValue(null);
  create.mockResolvedValue({ id: 'index-new' });
  update.mockResolvedValue({ id: 'index-old' });
  patchDeleteMany.mockResolvedValue({ count: 0 });
  archiveDeleteMany.mockResolvedValue({ count: 0 });
  transaction.mockImplementation(async (ops) => Promise.all(ops as Promise<unknown>[]));
});

describe('first build', () => {
  test('the index row and its archive are one write', async () => {
    const result = await service.buildIndex(params);

    expect(result).toEqual({ patchCount: 40, indexId: 'index-new' });
    expect(create).toHaveBeenCalledTimes(1);
    const data = (create.mock.calls[0]![0] as { data: Record<string, any> }).data;
    expect(data['status']).toBe('COMPLETE');
    expect(data['patchArchive'].create.patchCount).toBe(40);
    expect(data['patchArchive'].create.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.isBuffer(data['patchArchive'].create.blob)).toBe(true);
    // no second write that could fail on its own
    expect(archiveCreate).not.toHaveBeenCalled();
  });

  test('a failed write reports failure, and no patch rows are written either', async () => {
    create.mockRejectedValue(new Error('connection lost'));

    expect(await service.buildIndex(params)).toBeNull();
    expect(archiveCreate).not.toHaveBeenCalled();
    expect((prisma.localDnaPatch.createMany as unknown as jest.Mock).mock.calls).toHaveLength(0);
  });
});

describe('rebuild of an existing index', () => {
  beforeEach(() => { findUnique.mockResolvedValue({ id: 'index-old' }); });

  test('old rows, old archive and the new archive are replaced inside one transaction', async () => {
    const result = await service.buildIndex(params);

    expect(result).toEqual({ patchCount: 40, indexId: 'index-old' });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect((transaction.mock.calls[0]![0] as unknown[])).toHaveLength(3);
    const data = (update.mock.calls[0]![0] as { data: Record<string, any> }).data;
    expect(data['patchArchive'].create.patchCount).toBe(40);
    expect(archiveCreate).not.toHaveBeenCalled();
  });

  test('if the transaction fails the build reports failure — it never claims a rebuilt index', async () => {
    transaction.mockRejectedValue(new Error('deadlock detected'));

    expect(await service.buildIndex(params)).toBeNull();
  });
});
