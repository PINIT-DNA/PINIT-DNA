/**
 * Phase 5 — Enterprise vault candidate discovery & multi-layer ranking.
 * Never stops at first match — scores up to 100 candidates, deep-compares top tier.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { PerceptualLayer } from '../layers/layer3.perceptual';
import { aiService } from '../ai/ai-embeddings.service';
import type { VaultMatchResult } from './vault-auto-match.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import { isCameraScanFileName, candidateHasVisualSignal } from './vault-match-validator.service';

const PHASH_THRESHOLD = 0.65;
const MAX_CANDIDATES = 100;
const DEEP_COMPARE_TOP = 5;

export interface CandidateRankingOptions {
  relaxedVisual?: boolean;
}

export class VaultCandidateRankingService {
  private readonly perceptual = new PerceptualLayer();

  async findRankedCandidates(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    sizeBytes: number,
    ownerUserId: string,
    options?: CandidateRankingOptions,
  ): Promise<RankedVaultCandidate[]> {
    const phashThreshold = options?.relaxedVisual ? 0.52 : PHASH_THRESHOLD;
    const uploadedHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const scoreMap = new Map<string, RankedVaultCandidate>();

    const add = (c: Omit<RankedVaultCandidate, 'rank' | 'compositeScore'> & { compositeScore?: number }) => {
      const key = c.vaultId;
      const existing = scoreMap.get(key);
      const compositeScore = c.compositeScore ?? c.preliminaryScore;
      if (!existing || compositeScore > existing.compositeScore) {
        scoreMap.set(key, {
          ...c,
          compositeScore,
          rank: 0,
          signals: [...new Set([...(existing?.signals ?? []), ...c.signals])],
        });
      } else if (existing) {
        existing.signals = [...new Set([...existing.signals, ...c.signals])];
      }
    };

    const exact = await prisma.dnaRecord.findFirst({
      where: { sha256Hash: uploadedHash, ownerUserId, vaultRecord: { isNot: null } },
      include: { vaultRecord: true },
    });
    if (exact?.vaultRecord) {
      add({
        dnaRecordId: exact.id,
        vaultId: exact.vaultRecord.id,
        ownerUserId: exact.ownerUserId ?? ownerUserId,
        preliminaryScore: 100,
        compositeScore: 100,
        tier: 1,
        method: 'SHA-256 exact',
        signals: ['cryptographic_hash'],
      });
    }

    const vaultRows = await prisma.vaultRecord.findMany({
      where: { dnaRecord: { ownerUserId } },
      include: {
        dnaRecord: {
          select: {
            id: true,
            ownerUserId: true,
            imageFilename: true,
            sha256Hash: true,
            perceptualLayer: { select: { pHash64: true, aHash64: true, dHash64: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_CANDIDATES,
    });

    const cleanName = originalName
      .replace(/\s*\(\d+\)\s*/g, '')
      .replace(/\s*-\s*copy/gi, '')
      .trim()
      .toLowerCase();

    const isCameraScan = isCameraScanFileName(originalName);

    let probe: Awaited<ReturnType<PerceptualLayer['computeFingerprints']>> | null = null;
    if (mimeType.startsWith('image/')) {
      try {
        probe = await this.perceptual.computeFingerprints(buffer);
      } catch (e) {
        logger.debug('Candidate ranking: perceptual probe failed', { error: String(e) });
      }
    }

    for (const row of vaultRows) {
      let prelim = 0;
      const signals: string[] = [];

      const fname = row.originalFileName.replace(/\.[^.]+$/, '').toLowerCase();
      if (fname === cleanName.replace(/\.[^.]+$/, '')) {
        prelim = Math.max(prelim, 85);
        signals.push('filename_exact');
      } else if (!isCameraScan && (fname.includes(cleanName.replace(/\.[^.]+$/, '')) || cleanName.includes(fname))) {
        prelim = Math.max(prelim, 55);
        signals.push('filename_fuzzy');
      }

      const sizeRatio = Math.min(row.originalSizeBytes, sizeBytes) / Math.max(row.originalSizeBytes, sizeBytes);
      if (!isCameraScan && sizeRatio > 0.75) { prelim += 10; signals.push('size_match'); }
      else if (!isCameraScan && sizeRatio > 0.45) { prelim += 5; }

      if (probe && row.dnaRecord.perceptualLayer?.pHash64) {
        const pl = row.dnaRecord.perceptualLayer;
        const sim = this.perceptual.verify(probe, {
          pHash64: pl.pHash64,
          aHash64: pl.aHash64 ?? '',
          dHash64: pl.dHash64 ?? '',
        });
        if (sim >= phashThreshold) {
          prelim = Math.max(prelim, Math.round(sim * 100));
          signals.push('perceptual_hash');
        }
      }

      if (prelim >= (options?.relaxedVisual ? 30 : 40)) {
        add({
          dnaRecordId: row.dnaRecordId,
          vaultId: row.id,
          ownerUserId: row.dnaRecord.ownerUserId ?? ownerUserId,
          preliminaryScore: Math.min(99, prelim),
          tier: prelim >= 88 ? 4 : 3,
          method: signals.includes('perceptual_hash') ? 'Visual DNA candidate' : 'Heuristic candidate',
          signals,
        });
      }
    }

    try {
      const query = originalName.replace(/\.[^.]+$/, '').replace(/[_\-\.]/g, ' ');
      const semantic = await aiService.findSimilar(query, 15);
      for (const hit of semantic.results) {
        const vault = vaultRows.find((v) => v.dnaRecordId === hit.dnaRecordId);
        if (!vault) continue;
        const semScore = Math.round(hit.similarity * 100);
        add({
          dnaRecordId: hit.dnaRecordId,
          vaultId: vault.id,
          ownerUserId: vault.dnaRecord.ownerUserId ?? ownerUserId,
          preliminaryScore: semScore,
          compositeScore: semScore,
          tier: 3,
          method: 'Semantic embedding match',
          signals: ['semantic_dna', 'clip_similarity'],
        });
      }
    } catch { /* AI offline */ }

    const ranked = [...scoreMap.values()]
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, MAX_CANDIDATES)
      .map((c, i) => ({ ...c, rank: i + 1 }));

    return ranked;
  }

  toVaultMatch(candidate: RankedVaultCandidate): VaultMatchResult {
    const hasVisualDna = candidate.signals.includes('perceptual_hash')
      || candidate.signals.includes('structural_fingerprint')
      || candidate.signals.some((s) => s === 'local_features' || s === 'opencv_orb' || s === 'orb_akaze');
    const tier = candidate.tier ?? (hasVisualDna && candidate.compositeScore >= 80 ? 4 : 3);
    return {
      tier: tier as VaultMatchResult['tier'],
      method: `${candidate.method} (rank #${candidate.rank}, ${candidate.compositeScore}%)`,
      dnaRecordId: candidate.dnaRecordId,
      vaultId: candidate.vaultId,
      ownerUserId: candidate.ownerUserId,
      confidence: String(candidate.compositeScore),
      visualSimilarity: hasVisualDna || candidate.compositeScore >= 75
        ? candidate.compositeScore / 100
        : undefined,
    };
  }

  selectBestCandidate(candidates: RankedVaultCandidate[], minScore = 55): VaultMatchResult | null {
    if (!candidates.length) return null;
    const forensic = candidates.filter((c) => candidateHasVisualSignal(c) && c.compositeScore >= minScore);
    const best = forensic[0] ?? null;
    if (!best) return null;
    return this.toVaultMatch(best);
  }

  getDeepCompareIds(candidates: RankedVaultCandidate[]): string[] {
    return candidates
      .slice(0, DEEP_COMPARE_TOP)
      .filter((c) => c.compositeScore >= 40)
      .map((c) => c.vaultId);
  }
}

export const vaultCandidateRankingService = new VaultCandidateRankingService();
