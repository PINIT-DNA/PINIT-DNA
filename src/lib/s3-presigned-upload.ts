/**
 * PINIT-DNA — Presigned S3 upload for raw (pre-processing) asset intake
 *
 * Distinct from s3-storage.ts, which stores the already-encrypted vault blob
 * *after* the DNA pipeline runs. This module covers the earlier step: letting
 * the browser upload the original file bytes directly to S3, instead of
 * transiting the Node backend, per the ECS readiness audit §5 ("S3 Direct
 * Uploads" — a presign endpoint + a completion step that fetches the object
 * once processing is ready to run).
 *
 * Objects land under `incoming/{ownerUserId}/{uploadId}` — a random,
 * server-generated key, never a client-supplied one, so a client cannot
 * overwrite another upload by guessing/crafting a key. This prefix is
 * intentionally separate from the `{ownerUserId}/{vaultId}.enc` vault-blob
 * keys s3-storage.ts writes, since a vaultId does not exist yet at presign
 * time — the DnaRecord/VaultRecord are only created once the backend has
 * actually processed the uploaded bytes.
 *
 * IMPORTANT — a presigned PUT has no server-side size enforcement of its
 * own. The existing storage-quota preflight (entitlementService.
 * assertStorageAvailable, introduced in commit aa0cacd) must still run
 * twice: once against the client-declared size before minting the URL
 * (below), and again against the real S3 ContentLength after upload
 * completes (fetchRawUpload), since a client can lie about declared size to
 * a presigned PUT. This module intentionally does not call
 * entitlementService itself — see the route/controller wiring this feeds,
 * which owns that check, to avoid a lib module depending on a services
 * module and to keep the quota policy in one place.
 */

import { randomUUID } from 'crypto';
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client } from './s3-storage';
import { logger } from './logger';

const RAW_UPLOAD_PREFIX = 'incoming';
const DEFAULT_EXPIRES_SECONDS = 300;

function getBucket(): string {
  const bucket = process.env['S3_BUCKET']?.trim();
  if (!bucket) throw new Error('S3_BUCKET must be set for presigned uploads');
  return bucket;
}

export interface PresignedRawUpload {
  uploadId: string;
  key: string;
  url: string;
  expiresInSeconds: number;
}

/**
 * Mint a presigned PUT URL for a direct browser-to-S3 upload of one raw
 * (not-yet-processed) asset. The caller is responsible for the
 * declared-size storage-quota preflight before calling this.
 */
export async function createPresignedRawUploadUrl(params: {
  ownerUserId: string;
  contentType?: string;
  expiresInSeconds?: number;
}): Promise<PresignedRawUpload> {
  const uploadId = randomUUID();
  const key = `${RAW_UPLOAD_PREFIX}/${params.ownerUserId}/${uploadId}`;
  const expiresInSeconds = params.expiresInSeconds ?? DEFAULT_EXPIRES_SECONDS;

  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: params.contentType || 'application/octet-stream',
  });

  const url = await getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });

  logger.debug('[Storage] Minted presigned raw-upload URL', { ownerUserId: params.ownerUserId, uploadId });
  return { uploadId, key, url, expiresInSeconds };
}

/**
 * Re-check the real, server-observed size of a completed raw upload — never
 * trust the client's originally-declared size for the actual quota decision.
 * Returns null if the object does not exist (upload never completed, or the
 * caller is polling a stale/forged key).
 */
export async function headRawUpload(key: string): Promise<{ sizeBytes: number; contentType?: string } | null> {
  try {
    const head = await getS3Client().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
    if (typeof head.ContentLength !== 'number') return null;
    return { sizeBytes: head.ContentLength, contentType: head.ContentType };
  } catch {
    return null;
  }
}

/**
 * Fetch the raw uploaded bytes for processing. This is the "minimal-diff
 * seam" the audit describes: the DNA pipeline's existing Buffer-based
 * contract (DnaOrchestrator.generate()) does not change — only where the
 * Buffer comes from does (S3 GetObject instead of fs.readFile(req.file.path)).
 */
export async function fetchRawUpload(key: string): Promise<Buffer> {
  const result = await getS3Client().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  if (!result.Body) throw new Error(`S3 raw-upload fetch failed: no data for ${key}`);
  const chunks: Uint8Array[] = [];
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}
