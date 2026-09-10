/**
 * The integrity check must measure the file that is actually there.
 *
 * It used to check Supabase whenever Supabase was *configured*, regardless of where
 * the file was written. A vault blob on local disk was then compared against a stale
 * cloud object of a different size, and the Security Check page reported a "size
 * mismatch" for a file whose stored and actual sizes matched exactly.
 *
 * Caught for real: scanned_1pages_1789019281672.pdf, DB 941.8 KB, local file
 * 941.8 KB, page claimed actual 87.8 KB.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/lib/supabase-storage', () => ({
  isSupabaseStorageConfigured: jest.fn(() => true),
  findVaultFileInSupabase: jest.fn(async () => ({
    exists: true, size: 89_907, storagePath: 'owner/vault.enc',
  })),
}));

jest.mock('fs/promises', () => ({
  __esModule: true,
  default: { stat: jest.fn() },
}));

import fsPromises from 'fs/promises';
import { checkVaultEncryptedBlob } from '../../src/services/vault/vault-blob-integrity';
import {
  isSupabaseStorageConfigured,
  findVaultFileInSupabase,
} from '../../src/lib/supabase-storage';

const stat = fsPromises.stat as unknown as jest.Mock<AnyAsync>;
const supabaseConfigured = isSupabaseStorageConfigured as unknown as jest.Mock<() => boolean>;
const findInSupabase = findVaultFileInSupabase as unknown as jest.Mock<AnyAsync>;

// String.raw so the backslashes survive as backslashes, not escapes.
const LOCAL_PATH = String.raw`C:\Users\Someone\Pinit-DNA\vault\encrypted\ba2ac7c9.enc`;
const POSIX_LOCAL_PATH = '/srv/pinit/vault/encrypted/ba2ac7c9.enc';
const CLOUD_KEY = '10ea7e28-a459-44dc-a76c-26540a8499f2/ba2ac7c9.enc';
const VAULT_ID = 'ba2ac7c9-67f0-41af-afc2-1a294a1ccd4f';

beforeEach(() => {
  stat.mockReset();
  findInSupabase.mockReset();
  supabaseConfigured.mockReset();
  supabaseConfigured.mockReturnValue(true);
  findInSupabase.mockResolvedValue({ exists: true, size: 89_907, storagePath: 'x' });
});

describe('vault blob integrity', () => {
  test('a local path is measured on disk even when Supabase is configured', async () => {
    stat.mockResolvedValue({ size: 964_400 });

    const r = await checkVaultEncryptedBlob({
      vaultId: VAULT_ID, encryptedFilePath: LOCAL_PATH, ownerUserId: 'user-a',
    });

    expect(r.source).toBe('local');
    expect(r.actualSize).toBe(964_400);           // the real file
    expect(r.actualSize).not.toBe(89_907);        // not the stale cloud object
    expect(findInSupabase).not.toHaveBeenCalled();
  });

  test('a POSIX vault path is also measured on disk', async () => {
    stat.mockResolvedValue({ size: 555 });

    const r = await checkVaultEncryptedBlob({
      vaultId: VAULT_ID, encryptedFilePath: POSIX_LOCAL_PATH, ownerUserId: 'user-a',
    });

    expect(r.source).toBe('local');
    expect(r.actualSize).toBe(555);
    expect(findInSupabase).not.toHaveBeenCalled();
  });

  test('a Supabase object key is still checked in Supabase', async () => {
    const r = await checkVaultEncryptedBlob({
      vaultId: VAULT_ID, encryptedFilePath: CLOUD_KEY, ownerUserId: 'user-a',
    });

    expect(r.source).toBe('supabase');
    expect(r.actualSize).toBe(89_907);
    expect(stat).not.toHaveBeenCalled();
  });

  test('a local path whose file is gone falls back to Supabase, not a false "missing"', async () => {
    // A blob written locally then uploaded to the cloud is still present.
    stat.mockRejectedValue(new Error('ENOENT'));

    const r = await checkVaultEncryptedBlob({
      vaultId: VAULT_ID, encryptedFilePath: LOCAL_PATH, ownerUserId: 'user-a',
    });

    expect(r.exists).toBe(true);
    expect(r.source).toBe('supabase');
  });

  test('a local path that is genuinely gone, with no Supabase, reports missing', async () => {
    supabaseConfigured.mockReturnValue(false);
    stat.mockRejectedValue(new Error('ENOENT'));

    const r = await checkVaultEncryptedBlob({
      vaultId: VAULT_ID, encryptedFilePath: LOCAL_PATH,
    });

    expect(r.exists).toBe(false);
    expect(r.actualSize).toBeNull();
    expect(r.source).toBe('local');
  });

  test('with no Supabase at all, any path is measured on disk', async () => {
    supabaseConfigured.mockReturnValue(false);
    stat.mockResolvedValue({ size: 1234 });

    const r = await checkVaultEncryptedBlob({
      vaultId: VAULT_ID, encryptedFilePath: CLOUD_KEY,
    });

    expect(r.source).toBe('local');
    expect(r.actualSize).toBe(1234);
  });
});
