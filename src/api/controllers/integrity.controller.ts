/**
 * PINIT-DNA — Vault Integrity Controller (Phase 4.6)
 *
 * NEW endpoint — does NOT modify any existing vault or DNA logic.
 * Checks each vault record: does the .enc file exist on disk?
 *
 * GET /api/v1/vault/integrity-check
 */

import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export interface VaultIntegrityResult {
  vaultId: string;
  filename: string;
  encryptedFilePath: string;
  fileExists: boolean;
  fileSizeMatch: boolean;
  storedSize: number;
  actualSize: number | null;
  status: 'HEALTHY' | 'FILE_MISSING' | 'SIZE_MISMATCH' | 'ERROR';
  checkedAt: string;
}

export async function vaultIntegrityCheck(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    logger.info('Vault integrity check started');

    const vaultRecords = await prisma.vaultRecord.findMany({
      select: {
        id: true,
        originalFileName: true,
        encryptedFilePath: true,
        encryptedSizeBytes: true,
      },
    });

    const results: VaultIntegrityResult[] = await Promise.all(
      vaultRecords.map(async (r): Promise<VaultIntegrityResult> => {
        const encPath = r.encryptedFilePath;
        const checkedAt = new Date().toISOString();

        try {
          const stat = await fs.stat(encPath);
          const fileExists = true;
          const actualSize = stat.size;
          const fileSizeMatch = Math.abs(actualSize - r.encryptedSizeBytes) <= 32; // 32-byte tolerance

          return {
            vaultId:           r.id,
            filename:          r.originalFileName,
            encryptedFilePath: path.basename(encPath),
            fileExists,
            fileSizeMatch,
            storedSize:  r.encryptedSizeBytes,
            actualSize,
            status: !fileSizeMatch ? 'SIZE_MISMATCH' : 'HEALTHY',
            checkedAt,
          };
        } catch {
          return {
            vaultId:           r.id,
            filename:          r.originalFileName,
            encryptedFilePath: path.basename(encPath),
            fileExists:        false,
            fileSizeMatch:     false,
            storedSize:        r.encryptedSizeBytes,
            actualSize:        null,
            status:            'FILE_MISSING',
            checkedAt,
          };
        }
      })
    );

    const healthy  = results.filter(r => r.status === 'HEALTHY').length;
    const missing  = results.filter(r => r.status === 'FILE_MISSING').length;
    const mismatch = results.filter(r => r.status === 'SIZE_MISMATCH').length;

    logger.info('Vault integrity check complete', { total: results.length, healthy, missing, mismatch });

    res.status(200).json({
      success:    true,
      summary: {
        total:   results.length,
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
