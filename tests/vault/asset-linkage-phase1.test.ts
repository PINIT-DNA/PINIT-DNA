/**
 * Phase 1 — canonical Asset.id linkage.
 *
 * Proves the linkage rules that Phase 2/3 depend on:
 *  1. resolveVaultIdFromExchangeId prefers Asset.id and reports via:'asset'.
 *  2. A legacy VaultRecord.id still resolves, AND recovers the canonical
 *     Asset.id rather than returning null (the Phase 1 hardening).
 *  3. A VaultRecord.id with no linked Asset returns assetId:null — it does not
 *     fabricate a mapping.
 *  4. An unknown id resolves to null rather than guessing.
 *  5. assetId is never equal to vaultId (the class of bug Phase 1 closes).
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

const ASSET_ID = 'asset-uuid-canonical';
const VAULT_ID = 'vault-uuid-legacy';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const assetFindUnique = jest.fn<AnyAsync>();
const assetFindFirst = jest.fn<AnyAsync>();
const vaultFindUnique = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    asset: { findUnique: assetFindUnique, findFirst: assetFindFirst },
    vaultRecord: { findUnique: vaultFindUnique },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// The resolver is module-private, so exercise it through the exported surface
// that uses it. Import lazily so the mocks above are installed first.
async function resolve(id: string) {
  const mod = await import('../../src/services/exchange/exchange-bridge.service');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).__resolveVaultIdFromExchangeIdForTests(id);
}

describe('Phase 1 — canonical Asset.id resolution', () => {
  beforeEach(() => {
    assetFindUnique.mockReset();
    assetFindFirst.mockReset();
    vaultFindUnique.mockReset();
  });

  test('prefers Asset.id and reports via:asset', async () => {
    assetFindUnique.mockResolvedValue({ id: ASSET_ID, vaultId: VAULT_ID });
    const r = await resolve(ASSET_ID);
    expect(r).toEqual({ vaultId: VAULT_ID, assetId: ASSET_ID, via: 'asset' });
    expect(vaultFindUnique).not.toHaveBeenCalled();
  });

  test('legacy VaultRecord.id still resolves AND recovers canonical Asset.id', async () => {
    assetFindUnique.mockResolvedValue(null);
    vaultFindUnique.mockResolvedValue({ id: VAULT_ID });
    assetFindFirst.mockResolvedValue({ id: ASSET_ID });
    const r = await resolve(VAULT_ID);
    expect(r).toEqual({ vaultId: VAULT_ID, assetId: ASSET_ID, via: 'vault' });
  });

  test('does not fabricate an Asset.id when none is linked', async () => {
    assetFindUnique.mockResolvedValue(null);
    vaultFindUnique.mockResolvedValue({ id: VAULT_ID });
    assetFindFirst.mockResolvedValue(null);
    const r = await resolve(VAULT_ID);
    expect(r).toEqual({ vaultId: VAULT_ID, assetId: null, via: 'vault' });
  });

  test('unknown id resolves to null rather than guessing', async () => {
    assetFindUnique.mockResolvedValue(null);
    vaultFindUnique.mockResolvedValue(null);
    expect(await resolve('does-not-exist')).toBeNull();
    expect(await resolve('')).toBeNull();
  });

  test('assetId is never the same value as vaultId', async () => {
    assetFindUnique.mockResolvedValue({ id: ASSET_ID, vaultId: VAULT_ID });
    const r = await resolve(ASSET_ID);
    expect(r).not.toBeNull();
    expect(r!.assetId).not.toBe(r!.vaultId);
  });
});
