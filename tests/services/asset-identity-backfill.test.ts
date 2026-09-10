import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    vaultRecord: { findMany: jest.fn() },
    asset: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../../src/lib/prisma';
import { assetService } from '../../src/services/assets/asset.service';

const vaultFindMany = prisma.vaultRecord.findMany as unknown as jest.Mock<AnyAsync>;
const assetFindMany = prisma.asset.findMany as unknown as jest.Mock<AnyAsync>;

const OWNER = 'user-a';

const VAULT_ROW = {
  id: 'vault-1',
  dnaRecordId: 'dna-1',
  originalFileName: 'Ocean.jpg',
  originalMimeType: 'image/jpeg',
  originalSizeBytes: 91234,
  dnaRecord: { sha256Hash: 'abc123' },
};

let ensureSpy: jest.SpiedFunction<typeof assetService.ensureAssetFromProtect>;

beforeEach(() => {
  vaultFindMany.mockReset();
  assetFindMany.mockReset();
  // spyOn returns the same mock when the method is already spied, so its call
  // log survives across tests unless it is reset explicitly.
  ensureSpy = jest.spyOn(assetService, 'ensureAssetFromProtect');
  ensureSpy.mockReset();
  ensureSpy.mockResolvedValue({ id: 'asset-new' } as never);
});

describe('asset identity backfill', () => {
  test('gives a legacy protected file its Asset identity from records that already exist', async () => {
    vaultFindMany.mockResolvedValueOnce([VAULT_ROW]);
    assetFindMany.mockResolvedValueOnce([]); // nothing linked yet

    const result = await assetService.ensureAssetIdentityForOwner(OWNER);

    expect(result.created).toBe(1);
    expect(ensureSpy).toHaveBeenCalledTimes(1);

    // Every field is read off the vault/DNA rows — nothing is invented.
    expect(ensureSpy).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: OWNER,
      originalFilename: 'Ocean.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 91234,
      contentHash: 'abc123',
      vaultId: 'vault-1',
      dnaId: 'dna-1',
    }));
  });

  test('is idempotent — a vault that already has an Asset is left alone', async () => {
    vaultFindMany.mockResolvedValueOnce([VAULT_ROW]);
    assetFindMany.mockResolvedValueOnce([{ vaultId: 'vault-1' }]);

    const result = await assetService.ensureAssetIdentityForOwner(OWNER);

    expect(result.created).toBe(0);
    expect(result.alreadyLinked).toBe(1);
    expect(ensureSpy).not.toHaveBeenCalled();
  });

  test('keys on the same clientRequestId the live protect path writes', async () => {
    vaultFindMany.mockResolvedValueOnce([VAULT_ROW]);
    assetFindMany.mockResolvedValueOnce([]);

    await assetService.ensureAssetIdentityForOwner(OWNER);

    // Matching `hub:<dnaId>` is what makes a re-run a no-op rather than a
    // second Asset for the same file.
    expect(ensureSpy).toHaveBeenCalledWith(expect.objectContaining({
      clientRequestId: 'hub:dna-1',
      capturedVia: 'hub_protect_file',
    }));
  });

  test('one unprocessable file does not stop the rest', async () => {
    vaultFindMany.mockResolvedValueOnce([
      VAULT_ROW,
      { ...VAULT_ROW, id: 'vault-2', dnaRecordId: 'dna-2', originalFileName: 'Kochi.jpg' },
    ]);
    assetFindMany.mockResolvedValueOnce([]);
    ensureSpy
      .mockRejectedValueOnce(new Error('bad row'))
      .mockResolvedValueOnce({ id: 'asset-2' } as never);

    const result = await assetService.ensureAssetIdentityForOwner(OWNER);

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(1);
  });

  test('an owner with no protected files does no work', async () => {
    vaultFindMany.mockResolvedValueOnce([]);

    const result = await assetService.ensureAssetIdentityForOwner(OWNER);

    expect(result).toEqual({ created: 0, alreadyLinked: 0, skipped: 0 });
    expect(assetFindMany).not.toHaveBeenCalled();
    expect(ensureSpy).not.toHaveBeenCalled();
  });
});
