/**
 * Deleting a vault must not leave a stale Asset.vaultId behind.
 *
 * `Asset.vaultId` is a plain TEXT column with only an index — unlike
 * `Asset.dnaId`, which is a real relation carrying `onDelete: SetNull`. Nothing
 * at the database level clears it, so vault.service.delete() has to. These
 * tests pin that, and pin the things that must NOT happen while it does: the
 * asset survives, the DNA record survives, and the clear is transactional with
 * the delete so the two can never disagree.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

const OWNER = 'owner-uuid';
const OTHER_OWNER = 'someone-else-uuid';
const VAULT_ID = 'vault-uuid';
const DNA_ID = 'dna-uuid';

const vaultRecordRow = {
  id: VAULT_ID,
  dnaRecordId: DNA_ID,
  encryptedFilePath: `local:${VAULT_ID}`,
  originalFileName: 'Ocean.jpg',
  dnaRecord: { id: DNA_ID, ownerUserId: OWNER },
};

const vaultFindUnique = jest.fn(async (_a?: unknown) => vaultRecordRow as unknown);
const vaultDelete = jest.fn(async (_a?: unknown) => vaultRecordRow as unknown);
const vaultDeleteMany = jest.fn(async () => ({ count: 0 }));
const assetFindMany = jest.fn(async (_a?: unknown) => [{ id: 'asset-1' }] as unknown);
const assetUpdateMany = jest.fn(async (_a?: unknown) => ({ count: 1 }));
const assetDelete = jest.fn(async () => ({}));
const assetDeleteMany = jest.fn(async () => ({ count: 0 }));
const shareLinkUpdateMany = jest.fn(async (_a?: unknown) => ({ count: 0 }));
const dnaDelete = jest.fn(async () => ({}));
const timelineCreate = jest.fn(async (_a?: unknown) => ({}));

/** Every operation handed to a single $transaction call, in order. */
const transactionBatches: unknown[][] = [];
const transaction = jest.fn(async (ops: unknown) => {
  const list = ops as Promise<unknown>[];
  transactionBatches.push(list);
  return Promise.all(list);
});

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    vaultRecord: {
      findUnique: vaultFindUnique,
      delete: vaultDelete,
      deleteMany: vaultDeleteMany,
    },
    asset: {
      findMany: assetFindMany,
      updateMany: assetUpdateMany,
      delete: assetDelete,
      deleteMany: assetDeleteMany,
    },
    shareLink: { updateMany: shareLinkUpdateMany },
    dnaRecord: { delete: dnaDelete },
    assetTimelineEvent: { create: timelineCreate },
    $transaction: transaction,
  },
}));

jest.mock('../../src/lib/supabase-storage', () => ({
  uploadVaultFile: jest.fn(),
  downloadVaultFile: jest.fn(),
  deleteVaultFile: jest.fn(async () => undefined),
  findVaultFileInSupabase: jest.fn(),
  isSupabaseStorageConfigured: jest.fn(() => false),
  isSupabaseStorageRestricted: jest.fn(() => false),
}));

jest.mock('../../src/services/vault/encryption.service', () => ({
  encrypt: jest.fn(),
  decrypt: jest.fn(),
}));

jest.mock('../../src/services/identity/identity-embedding-pipeline.service', () => ({
  identityEmbeddingPipeline: { resolveCertificateId: jest.fn(), process: jest.fn() },
}));

jest.mock('../../src/services/forensics/forensic-provenance.service', () => ({
  forensicProvenanceService: { appendAsync: jest.fn() },
}));

jest.mock('../../src/services/platform-events/module-events', () => ({
  emitVaultStored: jest.fn(),
  emitVaultDeleted: jest.fn(),
}));

/** The arguments of the one asset.updateMany the delete issued. */
function clearCall(): { where: Record<string, unknown>; data: Record<string, unknown> } {
  return assetUpdateMany.mock.calls[0][0] as never;
}

async function deleteVault(owner = OWNER) {
  const { VaultService } = await import('../../src/services/vault/vault.service');
  return new VaultService().delete(VAULT_ID, owner);
}

beforeEach(() => {
  transactionBatches.length = 0;
  [
    vaultFindUnique, vaultDelete, vaultDeleteMany,
    assetFindMany, assetUpdateMany, assetDelete, assetDeleteMany,
    shareLinkUpdateMany, dnaDelete, timelineCreate, transaction,
  ].forEach((m) => m.mockClear());
  assetFindMany.mockResolvedValue([{ id: 'asset-1' }] as never);
});

describe('vault delete → Asset reference cleanup', () => {
  test('clears Asset.vaultId for the assets that pointed at the deleted vault', async () => {
    await deleteVault();

    expect(assetUpdateMany).toHaveBeenCalledTimes(1);
    expect(clearCall().where).toMatchObject({ vaultId: VAULT_ID });
    expect(clearCall().data).toEqual({ vaultId: null });
  });

  test('the clear is scoped to the owner, like every other asset write', async () => {
    await deleteVault();
    expect(clearCall().where.ownerUserId).toBe(OWNER);
  });

  test('the asset itself is never deleted — only the pointer goes', async () => {
    await deleteVault();

    expect(assetDelete).not.toHaveBeenCalled();
    expect(assetDeleteMany).not.toHaveBeenCalled();
    // The identity that outlives the file.
    expect(dnaDelete).not.toHaveBeenCalled();
  });

  test('the clear and the vault delete are one transaction', async () => {
    await deleteVault();

    // Two separate calls could half-succeed: a cleared pointer with the vault
    // still there, or the dangling reference this fix exists to prevent.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transactionBatches[0]).toHaveLength(3); // share links, asset clear, vault delete
    expect(vaultDelete).toHaveBeenCalledWith({ where: { id: VAULT_ID } });
  });

  test('a failed delete surfaces as a failure rather than a silent partial write', async () => {
    transaction.mockRejectedValueOnce(new Error('constraint'));

    // Rollback itself belongs to the database; what this pins is that the
    // service does not swallow the failure and report a delete that half
    // happened. Atomicity is covered by the single-transaction test above.
    await expect(deleteVault()).rejects.toThrow('constraint');
  });

  test('a vault with no asset pointing at it deletes cleanly', async () => {
    assetFindMany.mockResolvedValueOnce([] as never);

    await expect(deleteVault()).resolves.toMatchObject({ vaultId: VAULT_ID });
    // The clear still runs — it is a no-op, not a branch that can be skipped
    // wrongly — and nothing is written to a timeline that has no asset.
    expect(assetUpdateMany).toHaveBeenCalledTimes(1);
  });

  test('another user cannot delete this vault, and nothing is cleared', async () => {
    await expect(deleteVault(OTHER_OWNER)).rejects.toBeInstanceOf(Error);

    expect(assetUpdateMany).not.toHaveBeenCalled();
    expect(vaultDelete).not.toHaveBeenCalled();
  });
});
