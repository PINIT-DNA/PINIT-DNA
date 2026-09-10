/**
 * Shared vault blob presence check — follows where the file actually is.
 */
import fs from 'fs/promises';
import {
  findVaultFileInSupabase,
  isSupabaseStorageConfigured,
} from '../../lib/supabase-storage';
import { vaultEncryptedLooksLikeLocalPath } from './vault-storage-path';

export type VaultBlobCheck = {
  exists: boolean;
  actualSize: number | null;
  source: 'supabase' | 'local';
};

export async function checkVaultEncryptedBlob(params: {
  vaultId: string;
  encryptedFilePath: string;
  ownerUserId?: string | null;
}): Promise<VaultBlobCheck> {
  const { vaultId, encryptedFilePath, ownerUserId } = params;

  // The stored path says where this file was written; whether Supabase happens to
  // be configured does not. Checking the wrong backend measures a different file —
  // a local blob reported against a stale cloud object of another size shows up as
  // a "size mismatch" on the Security Check page for a file that is perfectly fine.
  const isLocalPath = vaultEncryptedLooksLikeLocalPath(encryptedFilePath);

  if (isLocalPath) {
    try {
      const stat = await fs.stat(encryptedFilePath);
      return { exists: true, actualSize: stat.size, source: 'local' };
    } catch {
      // The path claims local but nothing is there. Fall through to Supabase when
      // it is available: a file uploaded to the cloud after a local write still
      // counts as present, and reporting it missing would be the same false alarm
      // in the other direction.
      if (!isSupabaseStorageConfigured()) {
        return { exists: false, actualSize: null, source: 'local' };
      }
    }
  }

  if (isSupabaseStorageConfigured()) {
    const found = await findVaultFileInSupabase(vaultId, {
      ownerUserId: ownerUserId ?? undefined,
      storedPath: encryptedFilePath,
    });
    return {
      exists: found.exists,
      actualSize: found.size,
      source: 'supabase',
    };
  }

  try {
    const stat = await fs.stat(encryptedFilePath);
    return { exists: true, actualSize: stat.size, source: 'local' };
  } catch {
    return { exists: false, actualSize: null, source: 'local' };
  }
}
