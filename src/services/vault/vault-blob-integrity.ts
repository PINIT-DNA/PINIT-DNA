/**
 * Shared vault blob presence check — Supabase Storage when configured, else local disk.
 */
import fs from 'fs/promises';
import {
  findVaultFileInSupabase,
  isSupabaseStorageConfigured,
} from '../../lib/supabase-storage';

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
