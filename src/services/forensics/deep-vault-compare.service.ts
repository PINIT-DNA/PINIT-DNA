/**
 * Stage 11 — Full 15-layer DNA comparison against top vault candidates.
 * Live vault bytes + Prisma registry fingerprint cross-check (investigation-match-policy).
 */
import { logger } from '../../lib/logger';
import { VaultService } from '../vault/vault.service';
import { DnaComparisonService } from '../verification/dna-comparison.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import { logDeepCompareCandidate } from './investigation-pipeline-audit.service';
import { resolveMediaProfile } from './adaptive-scoring.service';
import { compareVideoInvestigation } from './video-forensic-compare.service';
import {
  DERIVATIVE_PROMOTE_L3_MIN,
  DERIVATIVE_WEAK_L3_MAX,
  INVESTIGATION_PREFER_LIVE_VAULT_FP,
  POSSIBLE_L3_MIN_WITHOUT_PATCH,
} from '../../config/investigation-match-policy';

export interface DeepCompareResult {
  vaultId: string;
  dnaRecordId: string;
  overallConfidenceScore: number;
  classification: string;
  tamperingDetected: boolean;
  matchedLayerCount: number;
  totalLayers: number;
  /** Per-layer scores for pipeline audit trace (live vault primary) */
  layerComparisons?: Array<{
    layer: number;
    name: string;
    similarityPercent: number;
    matched: boolean;
    skipped?: boolean;
  }>;
  /** Registry (Prisma dnaRecord) layers — audit / cross-check */
  registryLayerComparisons?: Array<{
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
 * after any edit/WhatsApp re-encode. Re-score content layers only (L2–L4).
 * L5 metadata excluded. DIFFERENT→SIMILAR only at strong perceptual (≥ promote min).
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
  let l2 = pct(2);
  let l3 = pct(3);
  let l4 = pct(4);
  const cls = classification.toUpperCase();
  const l3Pct = Math.round(l3 * 100);
  const promoteMin = DERIVATIVE_PROMOTE_L3_MIN;

  if (l3 >= promoteMin / 100) {
    if (l2 < 0.15) l2 = Math.max(l2, l3 * 0.55);
    if (l4 < 0.15) l4 = Math.max(l4, l3 * 0.50);
  }

  const weighted = Math.round((l2 * 0.25 + l3 * 0.60 + l4 * 0.15) * 100);
  const content = Math.max(weighted, l3Pct, Math.round(((l2 + l3 + l4) / 3) * 100));

  if (cls === 'DIFFERENT' && l3Pct < DERIVATIVE_WEAK_L3_MAX) {
    return { score: Math.min(overall, l3Pct), classification: 'DIFFERENT' };
  }

  const score = Math.max(overall, content);
  if (score >= promoteMin && cls === 'DIFFERENT' && l3Pct >= promoteMin) {
    return { score, classification: 'SIMILAR' };
  }
  return { score, classification };
}

function mapLayers(
  comps: Array<{ layer: number; name: string; similarityPercent: number; matched: boolean; skipped?: boolean }>,
) {
  return comps.map((l) => ({
    layer: l.layer,
    name: l.name,
    similarityPercent: l.skipped ? 0 : l.similarityPercent,
    matched: l.skipped ? false : l.matched,
    skipped: l.skipped,
  }));
}

/**
 * Merge live vault-byte DNA with Prisma registry DNA.
 * Disagreeing classifications with weak L3 → force DIFFERENT (anti-lookalike).
 */
export function mergeLiveAndRegistryDna(params: {
  liveAware: { score: number; classification: string };
  liveL3: number;
  registryAware: { score: number; classification: string } | null;
  registryL3: number;
}): { score: number; classification: string } {
  const liveCls = params.liveAware.classification.toUpperCase();
  if (!params.registryAware) {
    return params.liveAware;
  }
  const regCls = params.registryAware.classification.toUpperCase();
  const liveDiff = liveCls === 'DIFFERENT';
  const regDiff = regCls === 'DIFFERENT';
  const l3Cap = Math.max(params.liveL3, params.registryL3);

  if (liveDiff !== regDiff && l3Cap < POSSIBLE_L3_MIN_WITHOUT_PATCH) {
    return {
      score: Math.min(params.liveAware.score, params.registryAware.score, l3Cap || params.liveAware.score),
      classification: 'DIFFERENT',
    };
  }

  const score = !liveDiff && !regDiff
    ? Math.max(params.liveAware.score, params.registryAware.score)
    : liveDiff && regDiff
      ? Math.max(params.liveAware.score, params.registryAware.score)
      : Math.min(params.liveAware.score, params.registryAware.score);

  const classification = liveDiff && regDiff
    ? 'DIFFERENT'
    : !liveDiff && !regDiff
      ? (liveCls === 'DNA_MATCH' || regCls === 'DNA_MATCH' ? 'DNA_MATCH' : 'SIMILAR')
      : l3Cap >= POSSIBLE_L3_MIN_WITHOUT_PATCH
        ? 'SIMILAR'
        : 'DIFFERENT';

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

      const fileA = {
        filePath: '',
        originalName: original.originalFileName,
        declaredMimeType: original.originalMimeType,
        sizeBytes: original.originalSizeBytes,
        buffer: original.originalBuffer,
      };
      const fileB = {
        filePath: '',
        originalName: suspectName,
        declaredMimeType: suspectMime,
        sizeBytes: suspectSize,
        buffer: suspectBuffer,
      };

      if (isVideoProbe) {
        const cmp = await compareVideoInvestigation(
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
        );
        const layerComparisons = mapLayers(cmp.layerComparisons);
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
          matchedLayerCount: cmp.layerComparisons.filter((l) => l.matched).length,
          totalLayers: cmp.layerComparisons.length,
          layerComparisons,
        };
        logDeepCompareCandidate(candidate.vaultId, candidate.dnaRecordId, entry);
        return entry;
      }

      const [liveCmp, registryOnly] = await Promise.all([
        this.comparison.compare(fileA, fileB, {
          vaultDnaRecordId: candidate.dnaRecordId,
          preferLiveVaultFingerprint: INVESTIGATION_PREFER_LIVE_VAULT_FP,
        }),
        this.comparison.compare(
          {
            filePath: '',
            originalName: original.originalFileName,
            declaredMimeType: original.originalMimeType,
            sizeBytes: original.originalSizeBytes,
            buffer: Buffer.alloc(0),
          },
          fileB,
          { vaultDnaRecordId: candidate.dnaRecordId },
        ).catch((err) => {
          logger.warn('Registry DNA cross-check failed', {
            vaultId: candidate.vaultId.slice(0, 8),
            dnaRecordId: candidate.dnaRecordId.slice(0, 8),
            error: String(err),
          });
          return null;
        }),
      ]);

      const layerComparisons = mapLayers(liveCmp.layerComparisons);
      const liveAware = derivativeAwareScore(
        layerComparisons,
        liveCmp.overallConfidenceScore,
        liveCmp.classification,
      );
      const liveL3 = layerComparisons.find((l) => l.layer === 3)?.similarityPercent ?? 0;

      let registryLayerComparisons: DeepCompareResult['registryLayerComparisons'];
      let registryAware: { score: number; classification: string } | null = null;
      let registryL3 = 0;
      if (registryOnly) {
        registryLayerComparisons = mapLayers(registryOnly.layerComparisons);
        registryAware = derivativeAwareScore(
          registryLayerComparisons,
          registryOnly.overallConfidenceScore,
          registryOnly.classification,
        );
        registryL3 = registryLayerComparisons.find((l) => l.layer === 3)?.similarityPercent ?? 0;
      }

      const merged = mergeLiveAndRegistryDna({
        liveAware,
        liveL3,
        registryAware,
        registryL3,
      });

      const l1Match = !!layerComparisons.find((l) => l.layer === 1)?.matched;
      const entry: DeepCompareResult = {
        vaultId: candidate.vaultId,
        dnaRecordId: candidate.dnaRecordId,
        overallConfidenceScore: merged.score,
        classification: merged.classification,
        tamperingDetected: (
          liveCmp.tamperingDetected
          && !l1Match
          && merged.score >= 72
          && liveL3 >= 52
        ) || (merged.score >= 88 && !l1Match),
        matchedLayerCount: liveCmp.layerComparisons.filter((l) => l.matched).length,
        totalLayers: liveCmp.layerComparisons.length,
        layerComparisons,
        registryLayerComparisons,
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
