/**
 * PINIT-DNA — Auto Compare Controller (Advanced 3-Tier Matching)
 *
 * POST /api/v1/dna/auto-compare
 *
 * Upload ONE file → system finds the original from vault using 3 strategies:
 *   Tier 1: SHA-256 exact hash match against all DNA records
 *   Tier 2: Embedded identity signature extraction (HMAC-based)
 *   Tier 3: Fuzzy match — file name + mime type similarity across vault
 * Then runs full 10-layer DNA comparison.
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../../lib/logger';
import { DnaComparisonService } from '../../services/verification/dna-comparison.service';
import { vaultAutoMatchService } from '../../services/forensics/vault-auto-match.service';
import { VaultService } from '../../services/vault/vault.service';
import { getAuthUserId } from '../../lib/tenant-scope';
import { prisma } from '../../lib/prisma';

const comparisonService = new DnaComparisonService();
const vaultService = new VaultService();

export async function autoCompareDna(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const multerFile = req.file;
  const userId = getAuthUserId(req);

  if (!multerFile) {
    return next(new AppError(400, 'Missing file. Upload the suspected file using field "image".'));
  }

  let suspectedBuffer: Buffer;
  try {
    suspectedBuffer = await fs.readFile(multerFile.path);
  } catch {
    return next(new AppError(500, 'Failed to read uploaded file.'));
  }

  try {
    const uploadedHash = crypto.createHash('sha256').update(suspectedBuffer).digest('hex');
    logger.info('Auto-compare: vault match search', { hash: uploadedHash.slice(0, 16) });

    const match = await vaultAutoMatchService.findMatch(
      suspectedBuffer,
      multerFile.mimetype,
      multerFile.originalname,
      multerFile.size,
      userId,
    );

    if (!match) {
      res.status(200).json({
        success: false,
        autoMatched: false,
        searchedHash: uploadedHash.slice(0, 16) + '…',
        message: 'Could not find matching original in your vault. The file may not have been uploaded to PINIT-DNA, or belongs to another user.',
      });
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // MATCH FOUND — Retrieve original from vault and run full comparison
    // ═══════════════════════════════════════════════════════════════════
    let original;
    try {
      original = await vaultService.retrieve(match.vaultId, userId);
    } catch (e) {
      logger.error('Failed to retrieve vault file', { vaultId: match.vaultId, error: String(e) });
      res.status(200).json({
        success: false,
        autoMatched: false,
        message: `Found a match in vault but failed to retrieve the original file: ${String(e)}`,
      });
      return;
    }

    const owner = await prisma.user.findUnique({
      where: { id: match.ownerUserId },
      select: { id: true, fullName: true, email: true, shortId: true },
    });

    const dnaRecord = await prisma.dnaRecord.findUnique({
      where: { id: match.dnaRecordId },
      select: { imageFilename: true, createdAt: true, status: true },
    });

    const vaultRecord = await prisma.vaultRecord.findUnique({
      where: { id: match.vaultId },
      select: { createdAt: true, originalFileName: true },
    });

    // Check if files are byte-identical
    const isIdentical = original.originalBuffer.equals(suspectedBuffer);

    // Run full 10-layer DNA comparison
    let result;
    try {
    result = await comparisonService.compare(
      {
        filePath: '',
        originalName: original.originalFileName,
        declaredMimeType: original.originalMimeType,
        sizeBytes: original.originalSizeBytes,
        buffer: original.originalBuffer,
      },
      {
        filePath: multerFile.path,
        originalName: multerFile.originalname,
        declaredMimeType: multerFile.mimetype,
        sizeBytes: multerFile.size,
        buffer: suspectedBuffer,
      }
    );
    } catch (e) {
      logger.error('DNA comparison failed', { error: String(e) });
      result = null;
    }

    logger.info('Auto-compare complete', {
      tier: match.tier,
      method: match.method,
      classification: result?.classification ?? 'N/A',
      tamperingDetected: result?.tamperingDetected ?? false,
      isIdentical,
    });

    res.status(200).json({
      success: true,
      autoMatched: true,
      matchTier: match.tier,
      matchMethod: match.method,
      matchConfidence: match.confidence,
      isIdentical,
      identity: {
        dnaRecordId: match.dnaRecordId,
        dnaId: match.dnaRecordId,
        vaultId: match.vaultId,
        ownerUserId: match.ownerUserId,
        ownerName: owner?.fullName ?? null,
        ownerEmail: owner?.email ?? null,
        ownerShortId: owner?.shortId ?? null,
        originalFilename: original.originalFileName,
        dnaFilename: dnaRecord?.imageFilename ?? original.originalFileName,
        registeredAt: dnaRecord?.createdAt?.toISOString() ?? null,
        vaultedAt: vaultRecord?.createdAt?.toISOString() ?? null,
        dnaStatus: dnaRecord?.status ?? null,
      },
      originalFile: {
        fileName: original.originalFileName,
        mimeType: original.originalMimeType,
        sizeBytes: original.originalSizeBytes,
        dnaFilename: dnaRecord?.imageFilename ?? original.originalFileName,
        vaultedAt: vaultRecord?.createdAt?.toISOString() ?? null,
        registeredAt: dnaRecord?.createdAt?.toISOString() ?? null,
      },
      suspectedFile: {
        fileName: multerFile.originalname,
        mimeType: multerFile.mimetype,
        sizeBytes: multerFile.size,
        sha256: uploadedHash,
      },
      tampered: !isIdentical,
      ...(result ?? {}),
    });
  } catch (err) {
    logger.error('Auto-compare failed', { error: String(err) });
    next(err);
  } finally {
    await fs.unlink(multerFile.path).catch(() => {});
  }
}
