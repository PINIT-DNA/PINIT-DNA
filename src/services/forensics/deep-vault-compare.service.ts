/**
 * Stage 11 — Full 15-layer DNA comparison against top vault candidates.
 */
import { logger } from '../../lib/logger';
import { VaultService } from '../vault/vault.service';
import { DnaComparisonService } from '../verification/dna-comparison.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import { logDeepCompareCandidate } from './investigation-pipeline-audit.service';

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
      try {
        const original = await this.vault.retrieve(c.vaultId, ownerUserId);
        const cmp = await this.comparison.compare(
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
          { vaultDnaRecordId: c.dnaRecordId },
        );

        const matchedLayerCount = cmp.layerComparisons.filter((l) => l.matched).length;
        const layerComparisons = cmp.layerComparisons.map((l) => ({
          layer: l.layer,
          name: l.name,
          similarityPercent: l.similarityPercent,
          matched: l.matched,
        }));
        const entry: DeepCompareResult = {
          vaultId: c.vaultId,
          dnaRecordId: c.dnaRecordId,
          overallConfidenceScore: cmp.overallConfidenceScore,
          classification: cmp.classification,
          tamperingDetected: cmp.tamperingDetected,
          matchedLayerCount,
          totalLayers: cmp.layerComparisons.length,
          layerComparisons,
        };
        logDeepCompareCandidate(c.vaultId, c.dnaRecordId, entry);
        results.push(entry);
      } catch (e) {
        logger.warn('Deep vault compare failed for candidate', {
          vaultId: c.vaultId,
          error: String(e),
        });
      }
    }

    return results.sort((a, b) => b.overallConfidenceScore - a.overallConfidenceScore);
  }
}

export const deepVaultCompareService = new DeepVaultCompareService();
