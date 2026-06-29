/**
 * Vault auto-match — shared by Auto Compare and Unified Investigation.
 * Extracted from auto-compare.controller (behavior unchanged).
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { identityEmbeddingService } from '../identity/identity-embedding.service';

export interface VaultMatchResult {
  tier: 1 | 2 | 3;
  method: string;
  dnaRecordId: string;
  vaultId: string;
  ownerUserId: string;
  confidence: string;
}

export class VaultAutoMatchService {
  async findMatch(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sizeBytes: number,
    ownerUserId: string,
  ): Promise<VaultMatchResult | null> {
    const uploadedHash = crypto.createHash('sha256').update(buffer).digest('hex');

    const exactMatch = await prisma.dnaRecord.findFirst({
      where: {
        sha256Hash: uploadedHash,
        ownerUserId,
        vaultRecord: { isNot: null },
      },
      include: { vaultRecord: true },
    });

    if (exactMatch?.vaultRecord) {
      return {
        tier: 1,
        method: 'SHA-256 exact hash match',
        dnaRecordId: exactMatch.id,
        vaultId: exactMatch.vaultRecord.id,
        ownerUserId: exactMatch.ownerUserId ?? ownerUserId,
        confidence: 'EXACT',
      };
    }

    try {
      const identity = await identityEmbeddingService.extractAndVerify(buffer, mimeType, originalName);
      if (identity.found && identity.dnaId && identity.vaultId) {
        const dnaRec = await prisma.dnaRecord.findUnique({
          where: { id: identity.dnaId },
          select: { ownerUserId: true },
        });
        if (dnaRec?.ownerUserId === ownerUserId) {
          const vaultExists = await prisma.vaultRecord.findUnique({ where: { id: identity.vaultId } });
          if (vaultExists) {
            return {
              tier: 2,
              method: `Embedded identity (${identity.tampered ? 'file modified' : 'intact'})`,
              dnaRecordId: identity.dnaId,
              vaultId: identity.vaultId,
              ownerUserId: identity.ownerUserId ?? ownerUserId,
              confidence: identity.valid ? 'HIGH' : 'MEDIUM',
            };
          }
        }
      }
    } catch (e) {
      logger.warn('Vault auto-match Tier 2 failed', { error: String(e) });
    }

    const cleanName = originalName
      .replace(/\s*\(\d+\)\s*/g, '')
      .replace(/\s*-\s*copy/gi, '')
      .replace(/\s*copy\s*/gi, '')
      .trim();

    const filenameMatches = await prisma.vaultRecord.findMany({
      where: { dnaRecord: { ownerUserId } },
      include: { dnaRecord: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    let bestMatch: (typeof filenameMatches)[0] | null = null;
    let bestScore = 0;

    for (const candidate of filenameMatches) {
      let score = 0;
      const candidateName = candidate.originalFileName
        .replace(/\s*\(\d+\)\s*/g, '')
        .replace(/\s*-\s*copy/gi, '')
        .trim();

      if (candidateName.toLowerCase() === cleanName.toLowerCase()) score = 100;
      else if (
        candidateName.toLowerCase().includes(cleanName.toLowerCase().replace(/\.[^.]+$/, ''))
        || cleanName.toLowerCase().includes(candidateName.toLowerCase().replace(/\.[^.]+$/, ''))
      ) score = 70;
      else if (candidate.originalMimeType === mimeType) score = 30;

      const sizeRatio = Math.min(candidate.originalSizeBytes, sizeBytes)
        / Math.max(candidate.originalSizeBytes, sizeBytes);
      if (sizeRatio > 0.5) score += 20;
      if (sizeRatio > 0.8) score += 10;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidate;
      }
    }

    if (bestMatch && bestScore >= 50) {
      return {
        tier: 3,
        method: `Fuzzy filename match (${bestScore}%)`,
        dnaRecordId: bestMatch.dnaRecordId,
        vaultId: bestMatch.id,
        ownerUserId: bestMatch.dnaRecord?.ownerUserId ?? ownerUserId,
        confidence: bestScore >= 80 ? 'HIGH' : 'MEDIUM',
      };
    }

    return null;
  }
}

export const vaultAutoMatchService = new VaultAutoMatchService();
