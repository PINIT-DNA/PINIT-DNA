/**
 * PINIT-DNA — Auto Compare Controller (Advanced 3-Tier Matching)
 *
 * POST /api/v1/dna/auto-compare
 *
 * Upload ONE file → fast vault match (SHA / identity / visual), then optional
 * enterprise recovery fallback, then full 15-layer DNA comparison.
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../../lib/logger';
import { DnaComparisonService } from '../../services/verification/dna-comparison.service';
import { vaultAutoMatchService } from '../../services/forensics/vault-auto-match.service';
import { enterpriseRecoveryPipeline } from '../../services/forensics/enterprise-recovery-pipeline.service';
import { investigationPerformanceConfig } from '../../config/investigation-performance';
import {
  isTrustedVaultMatch,
  isAcceptedAfterDnaCompare,
  isCameraScanFileName,
  tamperStatusFromCompare,
  explainMatchBasis,
} from '../../services/forensics/vault-match-validator.service';
import { VaultService } from '../../services/vault/vault.service';
import { getAuthUserId } from '../../lib/tenant-scope';
import { prisma } from '../../lib/prisma';

const comparisonService = new DnaComparisonService();
const vaultService = new VaultService();

export async function autoCompareDna(
  req: Request,
  res: Response,
  next: NextFunction,
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
    const isCameraScan = isCameraScanFileName(multerFile.originalname);
    logger.info('Auto-compare: vault match search', { hash: uploadedHash.slice(0, 16) });

    // Fast path first — SHA / embedded identity / visual pHash (seconds, not minutes)
    let resolvedMatch = await vaultAutoMatchService.findMatch(
      suspectedBuffer,
      multerFile.mimetype,
      multerFile.originalname,
      multerFile.size,
      userId,
    );
    if (resolvedMatch && !isTrustedVaultMatch(resolvedMatch)) {
      resolvedMatch = null;
    }

    let recovery: Awaited<ReturnType<typeof enterpriseRecoveryPipeline.run>> | null = null;
    if (!resolvedMatch) {
      logger.info('Auto-compare: vault quick match missed — trying enterprise recovery');
      recovery = await enterpriseRecoveryPipeline.run(
        suspectedBuffer,
        multerFile.mimetype,
        multerFile.originalname,
        multerFile.size,
        userId,
        {
          twoStageRetrieval: true,
          investigationMode: true,
          skipProbeDna: true,
          fastVariants: true,
          candidatePoolSize: investigationPerformanceConfig.candidatePoolSize,
          deepCompareTopN: investigationPerformanceConfig.deepCompareTopN,
          orbTopK: investigationPerformanceConfig.orbRefineTopK,
        },
      );
      const candidate = recovery.match ?? recovery.probableMatch;
      if (candidate && isTrustedVaultMatch(candidate)) {
        resolvedMatch = candidate;
      }
    }

    if (!resolvedMatch) {
      res.status(200).json({
        success: false,
        autoMatched: false,
        searchedHash: uploadedHash.slice(0, 16) + '…',
        message: isCameraScan
          ? 'No forensic match found. Camera scans require visual DNA, watermark, or embedded identity — not filename alone.'
          : 'Could not find matching original in your vault. The file may not have been uploaded to PINIT-DNA, or belongs to another user.',
        recoveryStages: recovery?.stages ?? [],
        bestCandidate: recovery?.candidates[0] ?? null,
        candidateRanking: recovery?.candidates?.slice(0, 10) ?? [],
        ownershipConfidence: recovery?.fusion.ownershipConfidence ?? 0,
        fusionBreakdown: recovery?.fusion.breakdown ?? [],
      });
      return;
    }

    const isProbable = !recovery?.match && !!recovery?.probableMatch;

    let original;
    try {
      original = await vaultService.retrieve(resolvedMatch.vaultId, userId);
    } catch (e) {
      logger.error('Failed to retrieve vault file', { vaultId: resolvedMatch.vaultId, error: String(e) });
      res.status(200).json({
        success: false,
        autoMatched: false,
        message: `Found a match in vault but failed to retrieve the original file: ${String(e)}`,
        recoveryStages: recovery?.stages ?? [],
      });
      return;
    }

    const owner = await prisma.user.findUnique({
      where: { id: resolvedMatch.ownerUserId },
      select: { id: true, fullName: true, email: true, shortId: true },
    });

    const dnaRecord = await prisma.dnaRecord.findUnique({
      where: { id: resolvedMatch.dnaRecordId },
      select: { imageFilename: true, createdAt: true, status: true },
    });

    const vaultRecord = await prisma.vaultRecord.findUnique({
      where: { id: resolvedMatch.vaultId },
      select: { createdAt: true, originalFileName: true },
    });

    const isIdentical = original.originalBuffer.equals(suspectedBuffer);

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
        },
        { vaultDnaRecordId: resolvedMatch.dnaRecordId },
      );
    } catch (e) {
      logger.error('DNA comparison failed', { error: String(e) });
      result = null;
    }

    const compareScore = result?.overallConfidenceScore ?? 0;
    const classification = result?.classification ?? 'DIFFERENT';
    const tamperFlags = tamperStatusFromCompare(
      isIdentical,
      compareScore,
      classification,
      result?.tamperingDetected ?? false,
    );

    if (result && !isAcceptedAfterDnaCompare(resolvedMatch, compareScore, classification, isCameraScan)) {
      logger.warn('Auto-compare: match rejected after DNA comparison', {
        vaultId: resolvedMatch.vaultId,
        compareScore,
        classification,
        method: resolvedMatch.method,
      });
      res.status(200).json({
        success: false,
        autoMatched: false,
        matchRejected: true,
        message: `Vault candidate rejected — 15-layer DNA compare scored ${compareScore}% (${classification}). The scanned file does not match this vault record.`,
        recoveryStages: recovery?.stages ?? [],
        bestCandidate: recovery?.candidates[0] ?? null,
        candidateRanking: recovery?.candidates?.slice(0, 10) ?? [],
        ownershipConfidence: recovery?.fusion.ownershipConfidence ?? 0,
        rejectedMatch: {
          vaultId: resolvedMatch.vaultId,
          dnaRecordId: resolvedMatch.dnaRecordId,
          method: explainMatchBasis(resolvedMatch),
          compareScore,
          classification,
        },
        ...(result ?? {}),
      });
      return;
    }

    logger.info('Auto-compare complete', {
      tier: resolvedMatch.tier,
      method: resolvedMatch.method,
      probable: isProbable,
      classification: result?.classification ?? 'N/A',
      tamperingDetected: result?.tamperingDetected ?? false,
      isIdentical,
    });

    res.status(200).json({
      success: true,
      autoMatched: true,
      probableMatch: isProbable,
      matchTier: resolvedMatch.tier,
      matchMethod: explainMatchBasis(resolvedMatch),
      matchBasis: explainMatchBasis(resolvedMatch),
      matchConfidence: isProbable ? 'PROBABLE' : resolvedMatch.confidence,
      recoveryStages: recovery?.stages ?? [],
      candidateRanking: recovery?.candidates?.slice(0, 10) ?? [],
      fusionBreakdown: recovery?.fusion.breakdown ?? [],
      ownershipConfidence: recovery?.fusion.ownershipConfidence,
      isIdentical,
      identity: {
        dnaRecordId: resolvedMatch.dnaRecordId,
        dnaId: resolvedMatch.dnaRecordId,
        vaultId: resolvedMatch.vaultId,
        ownerUserId: resolvedMatch.ownerUserId,
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
      tampered: tamperFlags.tampered,
      tamperLabel: tamperFlags.label,
      ...(result ?? {}),
    });
  } catch (err) {
    logger.error('Auto-compare failed', { error: String(err) });
    next(err);
  } finally {
    await fs.unlink(multerFile.path).catch(() => {});
  }
}
