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
  // Prefer the service-role key (bypasses RLS); fall back to the anon key so the
  // app still boots on projects where only the public anon key is configured.
  const key = process.env['SUPABASE_SERVICE_KEY']?.trim()
    || process.env['SUPABASE_ANON_KEY']?.trim()
    || '';

  if (!url || !key) {
    throw new Error('SUPABASE_URL and a Supabase key (SERVICE or ANON) must be set for vault storage');
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
export async function uploadVaultFile(vaultId: string, buffer: Buffer, ownerUserId?: string): Promise<string> {
  const storagePath = ownerUserId ? `${ownerUserId}/${vaultId}.enc` : `${vaultId}.enc`;

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
export async function downloadVaultFile(vaultId: string, ownerUserId?: string): Promise<Buffer> {
  const paths = ownerUserId
    ? [`${ownerUserId}/${vaultId}.enc`, `${vaultId}.enc`]
    : [`${vaultId}.enc`];

  let lastError: Error | null = null;
  for (const storagePath of paths) {
    const { data, error } = await getClient().storage.from(BUCKET).download(storagePath);
    if (!error && data) {
      const arrayBuffer = await data.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    lastError = error ? new Error(error.message) : new Error(`No data for ${storagePath}`);
  }

  throw new Error(`Supabase download failed: ${lastError?.message ?? 'unknown'}`);
}

/** Delete vault file from Supabase Storage (on vault record deletion). */
export async function deleteVaultFile(vaultId: string): Promise<void> {
  const storagePath = `${vaultId}.enc`;
  const { error } = await getClient().storage.from(BUCKET).remove([storagePath]);
  if (error) logger.warn('[Storage] Delete failed (non-fatal)', { vaultId, error: error.message });
}
