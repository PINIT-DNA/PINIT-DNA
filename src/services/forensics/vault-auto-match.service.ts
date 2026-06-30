/**
 * Vault auto-match — shared by Auto Compare and Unified Investigation.
 * Extracted from auto-compare.controller (behavior unchanged).
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { identityEmbeddingService } from '../identity/identity-embedding.service';
import { PerceptualLayer } from '../layers/layer3.perceptual';

const PHASH_MATCH_THRESHOLD = 0.88;

export interface VaultMatchResult {
  tier: 1 | 2 | 3 | 4;
  method: string;
  dnaRecordId: string;
  vaultId: string;
  ownerUserId: string;
  confidence: string;
  visualSimilarity?: number;
}

export interface VaultMatchOptions {
  relaxedVisual?: boolean;
  phashThreshold?: number;
}

export class VaultAutoMatchService {
  private readonly perceptual = new PerceptualLayer();

  async findMatch(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sizeBytes: number,
    ownerUserId: string,
    options?: VaultMatchOptions,
  ): Promise<VaultMatchResult | null> {
    const phashThreshold = options?.phashThreshold
      ?? (options?.relaxedVisual ? 0.72 : PHASH_MATCH_THRESHOLD);
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
      const identity = await identityEmbeddingService.extractLoose(buffer, mimeType, originalName);
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

    // Tier 4: Visual fingerprint (images) — same engine as Verify Leaked File / DNA Compare scenarios
    if (mimeType.startsWith('image/')) {
      try {
        const visual = await this.matchByPerceptualHash(buffer, ownerUserId, phashThreshold);
        if (visual) return visual;
      } catch (e) {
        logger.warn('Vault auto-match Tier 4 failed', { error: String(e) });
      }
    }

    const cleanName = originalName
      .replace(/\s*\(\d+\)\s*/g, '')
      .replace(/\s*-\s*copy/gi, '')
      .replace(/\s*copy\s*/gi, '')
      .trim();

    const isCameraScan = /^(scan_|captured_|photo_|IMG_|image_)/i.test(cleanName);

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

    if (bestMatch && bestScore >= (isCameraScan ? 40 : 50)) {
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

  private async matchByPerceptualHash(
    buffer: Buffer,
    ownerUserId: string,
    threshold = PHASH_MATCH_THRESHOLD,
  ): Promise<VaultMatchResult | null> {
    const probe = await this.perceptual.computeFingerprints(buffer);
    const stored = await prisma.perceptualLayer.findMany({
      where: {
        dnaRecord: {
          ownerUserId,
          vaultRecord: { isNot: null },
        },
      },
      select: {
        pHash64: true,
        aHash64: true,
        dHash64: true,
        dnaRecordId: true,
        dnaRecord: {
          select: {
            ownerUserId: true,
            vaultRecord: { select: { id: true } },
          },
        },
      },
      take: 500,
    });

    let best: { similarity: number; dnaRecordId: string; vaultId: string; ownerUserId: string } | null = null;

    for (const row of stored) {
      if (!row.pHash64 || !row.dnaRecord.vaultRecord) continue;
      const sim = this.perceptual.verify(probe, {
        pHash64: row.pHash64,
        aHash64: row.aHash64 ?? '',
        dHash64: row.dHash64 ?? '',
      });
      if (sim >= threshold && (!best || sim > best.similarity)) {
        best = {
          similarity: sim,
          dnaRecordId: row.dnaRecordId,
          vaultId: row.dnaRecord.vaultRecord.id,
          ownerUserId: row.dnaRecord.ownerUserId ?? ownerUserId,
        };
      }
    }

    if (!best) return null;

    const pct = Math.round(best.similarity * 100);
    return {
      tier: 4,
      method: `Visual DNA match (${pct}% similar to vault original)`,
      dnaRecordId: best.dnaRecordId,
      vaultId: best.vaultId,
      ownerUserId: best.ownerUserId,
      confidence: String(pct),
      visualSimilarity: best.similarity,
    };
  }
}

export const vaultAutoMatchService = new VaultAutoMatchService();
