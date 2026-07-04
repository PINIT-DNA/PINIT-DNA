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
  }>;
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
        similarityPercent: l.similarityPercent,
        matched: l.matched,
      }));
      const entry: DeepCompareResult = {
        vaultId: candidate.vaultId,
        dnaRecordId: candidate.dnaRecordId,
        overallConfidenceScore: cmp.overallConfidenceScore,
        classification: cmp.classification,
        tamperingDetected: cmp.tamperingDetected,
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
