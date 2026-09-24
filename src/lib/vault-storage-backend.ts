/**
 * PINIT-DNA — Vault storage backend dispatcher
 *
 * The single seam between every consumer (vault.service.ts,
 * vault-blob-integrity.ts, health.ts, share-link.controller.ts) and the two
 * object-storage backends (Supabase Storage, Amazon S3). Selected via
 * config.storage.backend, defaulting to 'supabase' — today's unchanged
 * production path. Every consumer's own control flow (local-dev fallback,
 * USE_LOCAL branching, the Prisma encryptedFilePath contract, the nightly
 * integrity check, the health report) is unchanged by this file — it only
 * decides WHERE a storage call actually goes.
 *
 * S3 has no analogue of Supabase's "egress quota restricted" failure mode,
 * so isCloudStorageRestricted() always returns false on that backend — an S3
 * upload failure propagates as a real error instead of silently degrading to
 * local-only storage the way the Supabase path does in non-production.
 */

import { config } from '../config';
import * as supabaseBackend from './supabase-storage';
import * as s3Backend from './s3-storage';

export function isCloudStorageConfigured(): boolean {
  return config.storage.backend === 's3'
    ? s3Backend.isS3StorageConfigured()
    : supabaseBackend.isSupabaseStorageConfigured();
}

export function isCloudStorageRestricted(err: unknown): boolean {
  return config.storage.backend === 's3' ? false : supabaseBackend.isSupabaseStorageRestricted(err);
}

export async function uploadVaultFile(vaultId: string, buffer: Buffer, ownerUserId?: string): Promise<string> {
  return config.storage.backend === 's3'
    ? s3Backend.uploadVaultFile(vaultId, buffer, ownerUserId)
    : supabaseBackend.uploadVaultFile(vaultId, buffer, ownerUserId);
}

export async function downloadVaultFile(
  vaultId: string,
  ownerUserId: string,
  extraPaths: string[] = [],
): Promise<Buffer> {
  return config.storage.backend === 's3'
    ? s3Backend.downloadVaultFile(vaultId, ownerUserId, extraPaths)
    : supabaseBackend.downloadVaultFile(vaultId, ownerUserId, extraPaths);
}

export async function deleteVaultFile(
  vaultId: string,
  options?: { ownerUserId?: string; storedPath?: string },
): Promise<void> {
  return config.storage.backend === 's3'
    ? s3Backend.deleteVaultFile(vaultId, options)
    : supabaseBackend.deleteVaultFile(vaultId, options);
}

export async function findVaultFileInCloudStorage(
  vaultId: string,
  options?: { ownerUserId?: string; storedPath?: string },
): Promise<{ exists: boolean; size: number | null; storagePath: string | null }> {
  return config.storage.backend === 's3'
    ? s3Backend.findVaultFileInS3(vaultId, options)
    : supabaseBackend.findVaultFileInSupabase(vaultId, options);
}

/** Which backend is actually active — used by health.ts / vault-blob-integrity.ts
 * to report the correct source label instead of a hardcoded 'supabase'. */
export function activeStorageBackend(): 'supabase' | 's3' {
  return config.storage.backend === 's3' ? 's3' : 'supabase';
}
