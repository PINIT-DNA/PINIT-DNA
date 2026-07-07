/**
 * Stage 11 — Full 15-layer DNA comparison against top vault candidates.
 */
import { logger } from '../../lib/logger';
import { VaultService } from '../vault/vault.service';
import { DnaComparisonService } from '../verification/dna-comparison.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import { logDeepCompareCandidate } from './investigation-pipeline-audit.service';
import { resolveMediaProfile } from './adaptive-scoring.service';
import { compareVideoInvestigation } from './video-forensic-compare.service';

export interface DeepCompareResult {
  vaultId: string;
  dnaRecordId: string;
  overallConfidenceScore: number;
  classification: string;
  tamperingDetected: boolean;
  matchedLayerCount: number;
  totalLayers: number;
  /** Per-layer scores for pipeline audit trace */
  layerComparisons?: Array<{
    layer: number;
    name: string;
    similarityPercent: number;
    matched: boolean;
    skipped?: boolean;
  }>;
}

/**
 * Vault investigation score for derivatives/crops.
 * Full-frame overall weights L1 crypto (35%) + L6 signature (10%) — both always 0
 * after any edit/WhatsApp re-encode, so true derivatives cap near ~14–25% and never
 * pass the 40% acceptance gate. Re-score content layers only (L2–L5).
 */
export function derivativeAwareScore(
  layers: Array<{ layer: number; similarityPercent: number; matched: boolean }>,
  overall: number,
  classification: string,
): { score: number; classification: string } {
  const l1 = layers.find((l) => l.layer === 1);
  const l1Match = !!l1?.matched || (l1?.similarityPercent ?? 0) >= 100;
  if (l1Match) {
    return { score: overall, classification };
  }

  const pct = (n: number) => (layers.find((l) => l.layer === n)?.similarityPercent ?? 0) / 100;
  const l2 = pct(2);
  const l3 = pct(3);
  const l4 = pct(4);
  const l5 = pct(5);
  // Emphasize perceptual (crops/compress) — crypto/signature excluded.
  const weighted = Math.round((l2 * 0.20 + l3 * 0.65 + l4 * 0.10 + l5 * 0.05) * 100);
  // Perceptual alone is the primary crop/WhatsApp signal (L2 structural often 0 on crops).
  const content = Math.max(weighted, Math.round(l3 * 100));
  const score = Math.max(overall, content);
  // Only reclassify DIFFERENT→SIMILAR when perceptual content is strong enough for a real derivative
  if (score >= 62 && classification.toUpperCase() === 'DIFFERENT' && l3 * 100 >= 52) {
    return { score, classification: 'SIMILAR' };
  }
  return { score, classification };
}

export class DeepVaultCompareService {
  private readonly vault = new VaultService();
  private readonly comparison = new DnaComparisonService();

  /** Deep-compare a single vault candidate (used by ranking walk — never discard mid-batch). */
  async compareOneCandidate(
    suspectBuffer: Buffer,
    suspectMime: string,
    suspectName: string,
    suspectSize: number,
    candidate: RankedVaultCandidate,
    ownerUserId: string,
  ): Promise<DeepCompareResult | null> {
    try {
      const original = await this.vault.retrieve(candidate.vaultId, ownerUserId);
      const isVideoProbe = resolveMediaProfile(suspectMime, suspectName) === 'video';

      const cmp = isVideoProbe
        ? await compareVideoInvestigation(
            {
              buffer: original.originalBuffer,
              mimeType: original.originalMimeType,
              originalName: original.originalFileName,
              sizeBytes: original.originalSizeBytes,
            },
            {
              buffer: suspectBuffer,
              mimeType: suspectMime,
              originalName: suspectName,
              sizeBytes: suspectSize,
            },
          )
        : await this.comparison.compare(
            {
              filePath: '',
              originalName: original.originalFileName,
              declaredMimeType: original.originalMimeType,
              sizeBytes: original.originalSizeBytes,
              buffer: original.originalBuffer,
            },
            {
              filePath: '',
              originalName: suspectName,
              declaredMimeType: suspectMime,
              sizeBytes: suspectSize,
              buffer: suspectBuffer,
            },
            { vaultDnaRecordId: candidate.dnaRecordId },
          );

      const matchedLayerCount = cmp.layerComparisons.filter((l) => l.matched).length;
      const layerComparisons = cmp.layerComparisons.map((l) => ({
        layer: l.layer,
        name: l.name,
        similarityPercent: l.skipped ? 0 : l.similarityPercent,
        matched: l.skipped ? false : l.matched,
        skipped: l.skipped,
      }));
      const aware = derivativeAwareScore(
        layerComparisons,
        cmp.overallConfidenceScore,
        cmp.classification,
      );
      const l1Match = !!layerComparisons.find((l) => l.layer === 1)?.matched;
      const l3Score = layerComparisons.find((l) => l.layer === 3)?.similarityPercent ?? 0;
      const entry: DeepCompareResult = {
        vaultId: candidate.vaultId,
        dnaRecordId: candidate.dnaRecordId,
        overallConfidenceScore: aware.score,
        classification: aware.classification,
        tamperingDetected: (
          cmp.tamperingDetected
          && !l1Match
          && aware.score >= 72
          && l3Score >= 52
        ) || (aware.score >= 88 && !l1Match),
        matchedLayerCount,
        totalLayers: cmp.layerComparisons.length,
        layerComparisons,
      };
      logDeepCompareCandidate(candidate.vaultId, candidate.dnaRecordId, entry);
      return entry;
    } catch (e) {
      logger.warn('Deep vault compare failed for candidate', {
        vaultId: candidate.vaultId,
        error: String(e),
      });
      return null;
    }
  }

  async compareTopCandidates(
    suspectBuffer: Buffer,
    suspectMime: string,
    suspectName: string,
    suspectSize: number,
    candidates: RankedVaultCandidate[],
    ownerUserId: string,
    topN = 5,
  ): Promise<DeepCompareResult[]> {
    const results: DeepCompareResult[] = [];
    const top = candidates.slice(0, topN);

    for (const c of top) {
      const entry = await this.compareOneCandidate(
        suspectBuffer, suspectMime, suspectName, suspectSize, c, ownerUserId,
      );
      if (entry) results.push(entry);
    }

    return results.sort((a, b) => b.overallConfidenceScore - a.overallConfidenceScore);
  }
}

export const deepVaultCompareService = new DeepVaultCompareService();
