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

export function isSupabaseStorageRestricted(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /egress_quota|exceed_cached_egress|project is restricted|Failed to create storage bucket|Supabase upload failed/i.test(msg);
}

/** Ensure the vault-files bucket exists, creating it if not. */
async function ensureBucket(): Promise<void> {
  const client = getClient();
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  if (listError) {
    logger.warn('[Storage] listBuckets failed — assuming vault-files exists', { error: listError.message });
    return;
  }
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
      upsert:      true,
    });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  logger.debug('[Storage] Uploaded vault file', { vaultId, storagePath });
  return storagePath;
}

/** True when Supabase Storage env vars are present (required in production). */
export function isSupabaseStorageConfigured(): boolean {
  const url = process.env['SUPABASE_URL']?.trim() ?? '';
  const key = process.env['SUPABASE_SERVICE_KEY']?.trim()
    || process.env['SUPABASE_ANON_KEY']?.trim()
    || '';
  return Boolean(url && key);
}

/** Normalise a DB-stored path to a Supabase object key. */
export function normalizeVaultStoragePath(storedPath: string, vaultId: string): string {
  const norm = storedPath.replace(/\\/g, '/');
  // Already a bucket-relative key, e.g. "{ownerUserId}/{vaultId}.enc"
  if (!norm.includes(':') && norm.endsWith('.enc') && !norm.startsWith('/')) {
    return norm;
  }
  const base = norm.split('/').filter(Boolean).pop();
  return base?.endsWith('.enc') ? base : `${vaultId}.enc`;
}

/** Download encrypted buffer from Supabase Storage by object key. */
export async function downloadVaultFileByPath(storagePath: string): Promise<Buffer> {
  const { data, error } = await getClient().storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Supabase download failed: ${error?.message ?? `no data for ${storagePath}`}`);
  }
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Download encrypted buffer from Supabase Storage. */
export async function downloadVaultFile(
  vaultId: string,
  ownerUserId: string,
  extraPaths: string[] = [],
): Promise<Buffer> {
  if (!ownerUserId) {
    throw new Error('Vault download requires verified ownerUserId');
  }
  const paths = [
    ...extraPaths.map((p) => normalizeVaultStoragePath(p, vaultId)),
    `${ownerUserId}/${vaultId}.enc`,
    `${vaultId}.enc`,
  ].filter((p, i, arr): p is string => Boolean(p) && arr.indexOf(p) === i);

  let lastError: Error | null = null;
  for (const storagePath of paths) {
    try {
      return await downloadVaultFileByPath(storagePath);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw new Error(`Supabase download failed: ${lastError?.message ?? 'unknown'}`);
}

/** Delete vault file from Supabase Storage (on vault record deletion). */
export async function deleteVaultFile(
  vaultId: string,
  options?: { ownerUserId?: string; storedPath?: string },
): Promise<void> {
  const paths = [
    options?.storedPath ? normalizeVaultStoragePath(options.storedPath, vaultId) : null,
    options?.ownerUserId ? `${options.ownerUserId}/${vaultId}.enc` : null,
    `${vaultId}.enc`,
  ].filter((p, i, arr): p is string => Boolean(p) && arr.indexOf(p) === i);

  for (const storagePath of paths) {
    const { error } = await getClient().storage.from(BUCKET).remove([storagePath]);
    if (!error) {
      logger.debug('[Storage] Deleted vault file', { vaultId, storagePath });
      return;
    }
  }

  logger.warn('[Storage] Delete failed (non-fatal)', { vaultId });
}

/**
 * Check whether an encrypted vault blob exists in Supabase (or return null paths tried).
 * Uses Storage list metadata — does not download file bytes.
 */
export async function findVaultFileInSupabase(
  vaultId: string,
  options?: { ownerUserId?: string; storedPath?: string },
): Promise<{ exists: boolean; size: number | null; storagePath: string | null }> {
  const paths = [
    options?.storedPath ? normalizeVaultStoragePath(options.storedPath, vaultId) : null,
    options?.ownerUserId ? `${options.ownerUserId}/${vaultId}.enc` : null,
    `${vaultId}.enc`,
  ].filter((p, i, arr): p is string => Boolean(p) && arr.indexOf(p) === i);

  for (const storagePath of paths) {
    const segments = storagePath.split('/').filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) continue;
    const folder = segments.join('/');

    const { data, error } = await getClient().storage.from(BUCKET).list(folder || '', {
      search: fileName,
      limit: 20,
    });

    if (error) {
      logger.debug('[Storage] list failed', { storagePath, error: error.message });
      continue;
    }

    const match = data?.find((f) => f.name === fileName);
    if (match) {
      const sizeRaw = (match as { metadata?: { size?: number }; meta?: { size?: number } }).metadata?.size
        ?? (match as { meta?: { size?: number } }).meta?.size
        ?? null;
      const size = typeof sizeRaw === 'number' ? sizeRaw : null;
      return { exists: true, size, storagePath };
    }
  }

  return { exists: false, size: null, storagePath: null };
}
