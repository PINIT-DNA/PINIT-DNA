/**
 * PINIT-DNA — Auto Compare Controller
 *
 * POST /api/v1/dna/auto-compare
 *
 * Upload ONE file → PINIT Original Identity Recovery Algorithm finds the vault original,
 * runs full 15-layer DNA comparison, returns owner identity + tampering report.
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../../lib/logger';
import { DnaComparisonService } from '../../services/verification/dna-comparison.service';
import { enterpriseRecoveryPipeline } from '../../services/forensics/enterprise-recovery-pipeline.service';
import { tamperStatusFromCompare, explainMatchBasis } from '../../services/forensics/vault-match-validator.service';
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
    logger.info('Auto-compare: PINIT Original Identity Recovery', { hash: uploadedHash.slice(0, 16) });

    const recovery = await enterpriseRecoveryPipeline.run(
      suspectedBuffer,
      multerFile.mimetype,
      multerFile.originalname,
      multerFile.size,
      userId,
    );

    const resolvedMatch = recovery.identified ? recovery.match : null;

    if (!resolvedMatch) {
      res.status(200).json({
        success: false,
        autoMatched: false,
        identified: false,
        searchedHash: uploadedHash.slice(0, 16) + '…',
        message: 'No PINIT signature found.',
        recoveryStages: recovery.stages,
        bestCandidate: recovery.candidates[0] ?? null,
        candidateRanking: recovery.candidates.slice(0, 10),
        ownershipConfidence: recovery.fusion.ownershipConfidence,
        fusionBreakdown: recovery.fusion.breakdown,
        fusionMode: recovery.fusion.fusionMode,
        probableMatch: recovery.probableMatch ?? null,
        recoveredSignals: recovery.recoveredSignals,
        deepCompareResults: recovery.deepCompareResults,
      });
      return;
    }

    let original;
    try {
      original = await vaultService.retrieve(resolvedMatch.vaultId, userId);
    } catch (e) {
      logger.error('Failed to retrieve vault file', { vaultId: resolvedMatch.vaultId, error: String(e) });
      res.status(200).json({
        success: false,
        autoMatched: false,
        message: `Found vault match but failed to retrieve original: ${String(e)}`,
        recoveryStages: recovery.stages,
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

    const compareScore = result?.overallConfidenceScore ?? recovery.bestDeepCompare?.overallConfidenceScore ?? 0;
    const classification = result?.classification ?? recovery.bestDeepCompare?.classification ?? 'DIFFERENT';
    const tamperFlags = tamperStatusFromCompare(
      isIdentical,
      compareScore,
      classification,
      result?.tamperingDetected ?? recovery.bestDeepCompare?.tamperingDetected ?? false,
    );

    logger.info('Auto-compare complete', {
      identified: true,
      tier: resolvedMatch.tier,
      method: resolvedMatch.method,
      ownershipConfidence: recovery.fusion.ownershipConfidence,
      classification,
    });

    res.status(200).json({
      success: true,
      autoMatched: true,
      identified: true,
      pinitOriginalIdentified: true,
      matchTier: resolvedMatch.tier,
      matchMethod: explainMatchBasis(resolvedMatch),
      matchBasis: explainMatchBasis(resolvedMatch),
      matchConfidence: recovery.highConfidence ? 'ENTERPRISE' : resolvedMatch.confidence,
      recoveryStages: recovery.stages,
      candidateRanking: recovery.candidates.slice(0, 10),
      fusionBreakdown: recovery.fusion.breakdown,
      ownershipConfidence: recovery.fusion.ownershipConfidence,
      highConfidence: recovery.highConfidence,
      fusionMode: recovery.fusion.fusionMode,
      identificationPhase: 1,
      recoveredSignals: recovery.recoveredSignals,
      deepCompareResults: recovery.deepCompareResults,
      tamperingSummary: recovery.tamperingSummary,
      certificateId: recovery.certificateId,
      isIdentical,
      identity: {
        dnaRecordId: resolvedMatch.dnaRecordId,
        dnaId: resolvedMatch.dnaRecordId,
        vaultId: resolvedMatch.vaultId,
        ownerUserId: resolvedMatch.ownerUserId,
        ownerName: owner?.fullName ?? null,
        ownerEmail: owner?.email ?? null,
        ownerShortId: owner?.shortId ?? recovery.ownerShortId ?? null,
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
