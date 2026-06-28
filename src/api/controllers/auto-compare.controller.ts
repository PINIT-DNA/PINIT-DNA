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
import { identityEmbeddingService } from '../../services/identity/identity-embedding.service';
import { VaultService } from '../../services/vault/vault.service';
import { getAuthUserId } from '../../lib/tenant-scope';
import { prisma } from '../../lib/prisma';

const comparisonService = new DnaComparisonService();
const vaultService = new VaultService();

interface MatchResult {
  tier: 1 | 2 | 3;
  method: string;
  dnaRecordId: string;
  vaultId: string;
  ownerUserId: string;
  confidence: string;
}

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
    let match: MatchResult | null = null;

    // ═══════════════════════════════════════════════════════════════════
    // TIER 1: SHA-256 Exact Hash Match
    // If the file is identical to the original, hash will match exactly.
    // If tampered, hash won't match — but we still try other tiers.
    // ═══════════════════════════════════════════════════════════════════
    const uploadedHash = crypto.createHash('sha256').update(suspectedBuffer).digest('hex');
    logger.info('Auto-compare Tier 1: SHA-256 hash', { hash: uploadedHash.slice(0, 16) });

    const exactMatch = await prisma.dnaRecord.findFirst({
      where: {
        sha256Hash: uploadedHash,
        ownerUserId: userId,
        vaultRecord: { isNot: null },
      },
      include: { vaultRecord: true },
    });

    if (exactMatch?.vaultRecord) {
      match = {
        tier: 1,
        method: 'SHA-256 exact hash match — file is identical to vault original',
        dnaRecordId: exactMatch.id,
        vaultId: exactMatch.vaultRecord.id,
        ownerUserId: exactMatch.ownerUserId ?? userId,
        confidence: 'EXACT',
      };
      logger.info('Tier 1 matched', { dnaRecordId: exactMatch.id });
    }

    // ═══════════════════════════════════════════════════════════════════
    // TIER 2: Embedded Identity Signature Extraction
    // Works even if file content was modified — the signature is hidden
    // in metadata (PDF keywords), custom XML (Office), binary tail, etc.
    // ═══════════════════════════════════════════════════════════════════
    if (!match) {
      try {
        logger.info('Auto-compare Tier 2: Identity extraction');
        const identity = await identityEmbeddingService.extractAndVerify(
          suspectedBuffer,
          multerFile.mimetype,
          multerFile.originalname
        );

        if (identity.found && identity.dnaId && identity.vaultId) {
          const { dnaId, vaultId, ownerUserId: sigOwner } = identity as { dnaId: string; vaultId: string; ownerUserId: string };
          const dnaRec = await prisma.dnaRecord.findUnique({ where: { id: dnaId }, select: { ownerUserId: true } });
          if (!dnaRec || dnaRec.ownerUserId !== userId) {
            logger.info('Tier 2 skipped — signature belongs to another tenant', { dnaId });
          } else {
          const vaultExists = await prisma.vaultRecord.findUnique({ where: { id: vaultId } });
          if (vaultExists) {
            match = {
              tier: 2,
              method: `Identity signature extracted (${identity.tampered ? 'signature present but file modified' : 'signature verified intact'})`,
              dnaRecordId: dnaId,
              vaultId,
              ownerUserId: sigOwner,
              confidence: identity.valid ? 'HIGH' : 'MEDIUM',
            };
            logger.info('Tier 2 matched', { dnaId, vaultId });
          }
          }
        }
      } catch (e) {
        logger.warn('Tier 2 identity extraction failed, continuing', { error: String(e) });
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // TIER 3: Fuzzy Match — Search by filename similarity + CryptoLayer
    // Compare the uploaded file's hash against CryptoLayer normalizedHash,
    // and also try filename-based matching across user's vault files.
    // ═══════════════════════════════════════════════════════════════════
    if (!match) {
      logger.info('Auto-compare Tier 3: Fuzzy match');

      // Strategy A: Match by original filename (strip common suffixes like (1), copy, etc.)
      const cleanName = multerFile.originalname
        .replace(/\s*\(\d+\)\s*/g, '')  // Remove (1), (2)
        .replace(/\s*-\s*copy/gi, '')    // Remove - Copy
        .replace(/\s*copy\s*/gi, '')     // Remove copy
        .trim();

      const filenameMatches = await prisma.vaultRecord.findMany({
        where: {
          dnaRecord: { ownerUserId: userId },
        },
        include: { dnaRecord: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      // Score each candidate by filename similarity
      let bestMatch: typeof filenameMatches[0] | null = null;
      let bestScore = 0;

      for (const candidate of filenameMatches) {
        let score = 0;
        const candidateName = candidate.originalFileName
          .replace(/\s*\(\d+\)\s*/g, '')
          .replace(/\s*-\s*copy/gi, '')
          .trim();

        // Exact filename match (ignoring copy suffixes)
        if (candidateName.toLowerCase() === cleanName.toLowerCase()) {
          score = 100;
        }
        // Filename contains the other
        else if (
          candidateName.toLowerCase().includes(cleanName.toLowerCase().replace(/\.[^.]+$/, '')) ||
          cleanName.toLowerCase().includes(candidateName.toLowerCase().replace(/\.[^.]+$/, ''))
        ) {
          score = 70;
        }
        // Same mime type + same extension
        else if (candidate.originalMimeType === multerFile.mimetype) {
          score = 30;
        }

        // Boost if file sizes are similar (within 50%)
        const sizeRatio = Math.min(candidate.originalSizeBytes, multerFile.size) /
                          Math.max(candidate.originalSizeBytes, multerFile.size);
        if (sizeRatio > 0.5) score += 20;
        if (sizeRatio > 0.8) score += 10;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }

      if (bestMatch && bestScore >= 50) {
        match = {
          tier: 3,
          method: `Fuzzy match by filename similarity (${bestScore}% confidence) — "${bestMatch.originalFileName}"`,
          dnaRecordId: bestMatch.dnaRecordId,
          vaultId: bestMatch.id,
          ownerUserId: bestMatch.dnaRecord?.ownerUserId ?? userId,
          confidence: bestScore >= 80 ? 'HIGH' : 'MEDIUM',
        };
        logger.info('Tier 3 matched', {
          vaultId: bestMatch.id,
          score: bestScore,
          originalFileName: bestMatch.originalFileName,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // NO MATCH FOUND
    // ═══════════════════════════════════════════════════════════════════
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
        vaultId: match.vaultId,
        ownerUserId: match.ownerUserId,
        ownerName: owner?.fullName ?? null,
        ownerEmail: owner?.email ?? null,
        ownerShortId: owner?.shortId ?? null,
      },
      originalFile: {
        fileName: original.originalFileName,
        mimeType: original.originalMimeType,
        sizeBytes: original.originalSizeBytes,
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
