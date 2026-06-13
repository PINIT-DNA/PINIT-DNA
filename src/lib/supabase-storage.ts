/**
 * PINIT-DNA — Supabase Storage client
 *
 * Used exclusively for vault file storage (encrypted .enc blobs).
 * The database is accessed via Prisma/DATABASE_URL — this client is
 * only for the Storage API (bucket: vault-files).
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from './logger';

const SUPABASE_URL         = process.env['SUPABASE_URL'] ?? '';
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_KEY'] ?? '';
const BUCKET               = 'vault-files';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  logger.warn('[Storage] SUPABASE_URL or SUPABASE_SERVICE_KEY not set — vault uploads will fail');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

/** Upload encrypted buffer to Supabase Storage. Returns the storage path. */
export async function uploadVaultFile(vaultId: string, buffer: Buffer): Promise<string> {
  const storagePath = `${vaultId}.enc`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType:  'application/octet-stream',
      duplex:       'half',
      upsert:       false,
    });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  logger.debug('[Storage] Uploaded vault file', { vaultId, storagePath });
  return storagePath;
}

/** Download encrypted buffer from Supabase Storage. */
export async function downloadVaultFile(vaultId: string): Promise<Buffer> {
  const storagePath = `${vaultId}.enc`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);

  if (error) throw new Error(`Supabase download failed: ${error.message}`);
  if (!data)  throw new Error(`No data returned for vault file: ${storagePath}`);

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Delete vault file from Supabase Storage (on vault record deletion). */
export async function deleteVaultFile(vaultId: string): Promise<void> {
  const storagePath = `${vaultId}.enc`;
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) logger.warn('[Storage] Delete failed (non-fatal)', { vaultId, error: error.message });
}
