/**
 * PINIT-DNA — Vault Integrity Controller (Phase 4.6)
 *
 * Checks each vault record: does the encrypted blob exist in storage?
 * Uses Supabase Storage when configured (production); otherwise local disk.
 *
 * GET /api/v1/vault/integrity-check
 */

import { Request, Response, NextFunction } from 'express';
import path from 'path';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { getAuthUserId, vaultOwnerWhere } from '../../lib/tenant-scope';
import { checkVaultEncryptedBlob } from '../../services/vault/vault-blob-integrity';

export interface VaultIntegrityResult {
  vaultId: string;
  filename: string;
  encryptedFilePath: string;
  fileExists: boolean;
  fileSizeMatch: boolean;
  storedSize: number;
  actualSize: number | null;
  status: 'HEALTHY' | 'FILE_MISSING' | 'SIZE_MISMATCH' | 'ERROR';
  storageSource: 'supabase' | 'local';
  checkedAt: string;
}

export async function vaultIntegrityCheck(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    logger.info('Vault integrity check started', { userId });

    const vaultRecords = await prisma.vaultRecord.findMany({
      where: vaultOwnerWhere(userId),
      select: {
        id: true,
        originalFileName: true,
        encryptedFilePath: true,
        encryptedSizeBytes: true,
        dnaRecord: { select: { ownerUserId: true } },
      },
    });

    const results: VaultIntegrityResult[] = await Promise.all(
      vaultRecords.map(async (r): Promise<VaultIntegrityResult> => {
        const checkedAt = new Date().toISOString();
        const encPath = r.encryptedFilePath;

        try {
          const check = await checkVaultEncryptedBlob({
            vaultId: r.id,
            encryptedFilePath: encPath,
            ownerUserId: r.dnaRecord?.ownerUserId ?? userId,
          });

          if (!check.exists) {
            return {
              vaultId: r.id,
              filename: r.originalFileName,
              encryptedFilePath: path.basename(encPath),
              fileExists: false,
              fileSizeMatch: false,
              storedSize: r.encryptedSizeBytes,
              actualSize: null,
              status: 'FILE_MISSING',
              storageSource: check.source,
              checkedAt,
            };
          }

          // When Supabase list omits size, treat presence as healthy (avoid false mismatch)
          const actualSize = check.actualSize;
          const fileSizeMatch =
            actualSize == null
              ? true
              : Math.abs(actualSize - r.encryptedSizeBytes) <= 32;

          return {
            vaultId: r.id,
            filename: r.originalFileName,
            encryptedFilePath: path.basename(encPath),
            fileExists: true,
            fileSizeMatch,
            storedSize: r.encryptedSizeBytes,
            actualSize,
            status: !fileSizeMatch ? 'SIZE_MISMATCH' : 'HEALTHY',
            storageSource: check.source,
            checkedAt,
          };
        } catch {
          return {
            vaultId: r.id,
            filename: r.originalFileName,
            encryptedFilePath: path.basename(encPath),
            fileExists: false,
            fileSizeMatch: false,
            storedSize: r.encryptedSizeBytes,
            actualSize: null,
            status: 'ERROR',
            storageSource: 'supabase',
            checkedAt,
          };
        }
      }),
    );

    const healthy = results.filter((r) => r.status === 'HEALTHY').length;
    const missing = results.filter((r) => r.status === 'FILE_MISSING').length;
    const mismatch = results.filter((r) => r.status === 'SIZE_MISMATCH').length;

    logger.info('Vault integrity check complete', { total: results.length, healthy, missing, mismatch });

    res.status(200).json({
      success: true,
      summary: {
        total: results.length,
        healthy,
        missing,
        mismatch,
        overallHealth: missing + mismatch === 0 ? 'HEALTHY' : missing > 0 ? 'CRITICAL' : 'WARNING',
      },
      checkedAt: new Date().toISOString(),
      results,
    });
  } catch (err) {
    next(err);
  }
}
