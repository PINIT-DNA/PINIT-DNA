/**
 * PINIT-DNA — Supabase Storage client
 *
 * Used exclusively for vault file storage (encrypted .enc blobs).
 * The database is accessed via Prisma/DATABASE_URL — this client is
 * only for the Storage API (bucket: vault-files).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

const BUCKET = 'vault-files';

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env['SUPABASE_URL'] ?? '';
  const key = process.env['SUPABASE_SERVICE_KEY'] ?? '';

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set for vault storage');
  }

  _client = createClient(url, key, { auth: { persistSession: false } });
  logger.info('[Storage] Supabase Storage client initialised');
  return _client;
}

/** Ensure the vault-files bucket exists, creating it if not. */
async function ensureBucket(): Promise<void> {
  const client = getClient();
  const { data: buckets } = await client.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    const { error } = await client.storage.createBucket(BUCKET, { public: false });
    if (error) throw new Error(`Failed to create storage bucket: ${error.message}`);
    logger.info('[Storage] Created bucket', { bucket: BUCKET });
  }
}

let _bucketReady = false;

/** Upload encrypted buffer to Supabase Storage. Returns the storage path. */
export async function uploadVaultFile(vaultId: string, buffer: Buffer): Promise<string> {
  const storagePath = `${vaultId}.enc`;

  if (!_bucketReady) {
    await ensureBucket();
    _bucketReady = true;
  }

  const { error } = await getClient().storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'application/octet-stream',
      upsert:      false,
    });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  logger.debug('[Storage] Uploaded vault file', { vaultId, storagePath });
  return storagePath;
}

/** Download encrypted buffer from Supabase Storage. */
export async function downloadVaultFile(vaultId: string): Promise<Buffer> {
  const storagePath = `${vaultId}.enc`;

  const { data, error } = await getClient().storage
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
  const { error } = await getClient().storage.from(BUCKET).remove([storagePath]);
  if (error) logger.warn('[Storage] Delete failed (non-fatal)', { vaultId, error: error.message });
}
