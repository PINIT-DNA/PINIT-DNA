/**
 * PINIT-DNA — Amazon S3 storage client
 *
 * S3-backed equivalent of supabase-storage.ts: same operations, same storage-key
 * convention ({ownerUserId}/{vaultId}.enc), so vault.service.ts can eventually
 * switch backends via config.storage.backend without changing its own call
 * sites (see src/lib/vault-storage-backend.ts).
 *
 * Credentials are never read here — the AWS SDK's default credential chain
 * (an ECS task IAM role in production, AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY
 * or a local profile in dev) resolves them. Bucket provisioning belongs in
 * Terraform/CDK, not runtime code (see docs/PINIT-DNA_ECS_Production_Readiness_Audit.pdf, §5).
 */

import type { S3Client } from '@aws-sdk/client-s3';
import { logger } from './logger';

type S3Sdk = typeof import('@aws-sdk/client-s3');
let _sdk: S3Sdk | null = null;

/**
 * The AWS SDK is loaded on first use, not at import time. It is large, and most
 * processes (Supabase backend, unit tests, the API before any S3 call) never
 * touch S3 — loading it eagerly taxed every process start for nothing.
 */
export function getS3Sdk(): S3Sdk {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (_sdk ??= require('@aws-sdk/client-s3') as S3Sdk);
}

let _client: S3Client | null = null;

function getBucket(): string {
  const bucket = process.env['S3_BUCKET']?.trim();
  if (!bucket) throw new Error('S3_BUCKET must be set for S3 vault storage');
  return bucket;
}

export function getS3Client(): S3Client {
  if (_client) return _client;
  const region = process.env['AWS_REGION']?.trim() || 'ap-south-1';
  _client = new (getS3Sdk().S3Client)({ region });
  logger.info('[Storage] S3 client initialised', { region });
  return _client;
}

/** True when S3 storage env vars are present (bucket configured). */
export function isS3StorageConfigured(): boolean {
  return Boolean(process.env['S3_BUCKET']?.trim());
}

/** Normalise a DB-stored path to an S3 object key — identical convention to
 * Supabase Storage, so an existing VaultRecord.encryptedFilePath value is a
 * valid S3 key unchanged if a vault is ever migrated between backends. */
export function normalizeVaultStoragePath(storedPath: string, vaultId: string): string {
  const norm = storedPath.replace(/\\/g, '/');
  if (!norm.includes(':') && norm.endsWith('.enc') && !norm.startsWith('/')) {
    return norm;
  }
  const base = norm.split('/').filter(Boolean).pop();
  return base?.endsWith('.enc') ? base : `${vaultId}.enc`;
}

/** Upload an already-encrypted vault blob to S3. Returns the storage key. */
export async function uploadVaultFile(vaultId: string, buffer: Buffer, ownerUserId?: string): Promise<string> {
  const storagePath = ownerUserId ? `${ownerUserId}/${vaultId}.enc` : `${vaultId}.enc`;
  try {
    await getS3Client().send(new (getS3Sdk().PutObjectCommand)({
      Bucket: getBucket(),
      Key: storagePath,
      Body: buffer,
      ContentType: 'application/octet-stream',
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`S3 upload failed: ${msg}`);
  }
  logger.debug('[Storage] Uploaded vault file to S3', { vaultId, storagePath });
  return storagePath;
}

/** Download an encrypted vault blob from S3 by exact object key. */
export async function downloadVaultFileByPath(storagePath: string): Promise<Buffer> {
  const bucket = getBucket();
  try {
    const result = await getS3Client().send(new (getS3Sdk().GetObjectCommand)({ Bucket: bucket, Key: storagePath }));
    if (!result.Body) throw new Error(`no data for ${storagePath}`);
    const chunks: Uint8Array[] = [];
    // Body is a Node Readable at runtime for @aws-sdk/client-s3 on Node targets.
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`S3 download failed: ${msg}`);
  }
}

/** Download an encrypted vault blob from S3, trying a few plausible key
 * shapes — mirrors downloadVaultFile's fallback-path behavior in
 * supabase-storage.ts so vault.service.ts's retrieve() can call either
 * backend identically. */
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
  throw new Error(`S3 download failed: ${lastError?.message ?? 'unknown'}`);
}

/** Delete a vault file from S3 (on vault record deletion). Non-fatal on failure,
 * matching supabase-storage.ts's deleteVaultFile behavior. */
export async function deleteVaultFile(
  vaultId: string,
  options?: { ownerUserId?: string; storedPath?: string },
): Promise<void> {
  const bucket = getBucket();
  const paths = [
    options?.storedPath ? normalizeVaultStoragePath(options.storedPath, vaultId) : null,
    options?.ownerUserId ? `${options.ownerUserId}/${vaultId}.enc` : null,
    `${vaultId}.enc`,
  ].filter((p, i, arr): p is string => Boolean(p) && arr.indexOf(p) === i);

  for (const storagePath of paths) {
    try {
      await getS3Client().send(new (getS3Sdk().DeleteObjectCommand)({ Bucket: bucket, Key: storagePath }));
      logger.debug('[Storage] Deleted vault file from S3', { vaultId, storagePath });
      return;
    } catch {
      // try the next candidate path
    }
  }
  logger.warn('[Storage] S3 delete failed (non-fatal)', { vaultId });
}

/** Check whether an encrypted vault blob exists in S3 (HEAD only, no body download). */
export async function findVaultFileInS3(
  vaultId: string,
  options?: { ownerUserId?: string; storedPath?: string },
): Promise<{ exists: boolean; size: number | null; storagePath: string | null }> {
  const bucket = getBucket();
  const paths = [
    options?.storedPath ? normalizeVaultStoragePath(options.storedPath, vaultId) : null,
    options?.ownerUserId ? `${options.ownerUserId}/${vaultId}.enc` : null,
    `${vaultId}.enc`,
  ].filter((p, i, arr): p is string => Boolean(p) && arr.indexOf(p) === i);

  for (const storagePath of paths) {
    try {
      const head = await getS3Client().send(new (getS3Sdk().HeadObjectCommand)({ Bucket: bucket, Key: storagePath }));
      return { exists: true, size: head.ContentLength ?? null, storagePath };
    } catch {
      // not found at this key, try the next
    }
  }
  return { exists: false, size: null, storagePath: null };
}

/** Best-effort bucket reachability check for the health endpoint — logged,
 * never throws. Bucket creation itself is an infra (Terraform/CDK) concern,
 * not runtime code, unlike Supabase Storage's ensureBucket(). */
export async function checkS3BucketReachable(): Promise<boolean> {
  try {
    await getS3Client().send(new (getS3Sdk().HeadBucketCommand)({ Bucket: getBucket() }));
    return true;
  } catch (err) {
    logger.warn('[Storage] S3 bucket HEAD check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
