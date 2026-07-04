/**
 * Image-only candidate acceptance — walk ranked vault candidates and reject
 * any that fail DNA / ORB / fusion gates. Video paths must not use this module.
 *
 * Does not modify perceptual / ORB / DNA algorithms — only decision thresholds.
 */
import { logger } from '../../lib/logger';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import type { VaultSimilarityVector } from './vault-similarity-vector.service';
import type { DeepCompareResult } from './deep-vault-compare.service';
import type { LocalDnaSearchHit } from './vault-local-dna-search.service';
import type { VaultMatchResult } from './vault-auto-match.service';
import { vaultCandidateRankingService } from './vault-candidate-ranking.service';
import type { AuthoritativeSelectionSource } from '../../types/authoritative-asset.types';

/** Image acceptance thresholds — DNA must confirm the vault pairing. */
export const IMAGE_DNA_ACCEPT_MIN = 42;
export const IMAGE_ORB_ACCEPT_MIN = 40;
export const IMAGE_FUSION_ACCEPT_MIN = 45;
export const IMAGE_VECTOR_COMPOSITE_MIN = 50;

export interface CandidateScoreLog {
  rank: number;
  vaultId: string;
  filename?: string;
  vectorSimilarity: number;
  clipSimilarity: number;
  orbScore: number;
  pHashSimilarity: number;
  dnaScore: number;
  dnaClassification: string;
  fusionScore: number;
  decision: 'ACCEPT' | 'REJECT';
  rejectReasons: string[];
}

export interface ImageAcceptanceResult {
  accepted: boolean;
  match: VaultMatchResult | null;
  source: AuthoritativeSelectionSource | 'none';
  deepCompare: DeepCompareResult | null;
  logs: CandidateScoreLog[];
}

function vectorFor(
  vaultId: string,
  vectors: VaultSimilarityVector[],
): VaultSimilarityVector | undefined {
  return vectors.find((v) => v.vaultId === vaultId);
}

function deepFor(
  vaultId: string,
  deepResults: DeepCompareResult[],
): DeepCompareResult | undefined {
  return deepResults.find((d) => d.vaultId === vaultId);
}

/**
 * Fusion proxy for a single candidate (image only).
 * Uses vector + DNA + local patch — never inflates past a failed DNA score.
 */
export function imageCandidateFusionScore(params: {
  dnaScore: number;
  dnaClassification: string;
  vectorComposite: number;
  orbScore: number;
  pHash: number;
  localPatchScore: number;
}): number {
  const { dnaScore, dnaClassification, vectorComposite, orbScore, pHash, localPatchScore } = params;
  if (dnaClassification === 'DIFFERENT' && dnaScore < IMAGE_DNA_ACCEPT_MIN) {
    return Math.min(dnaScore, vectorComposite, 25);
  }
  const peak = Math.max(dnaScore, orbScore, pHash, localPatchScore, vectorComposite);
  return Math.round(
    dnaScore * 0.40
    + orbScore * 0.20
    + pHash * 0.15
    + vectorComposite * 0.15
    + localPatchScore * 0.10
    + (peak >= 70 ? 5 : 0),
  );
}

export function evaluateImageCandidate(params: {
  rank: number;
  candidate: RankedVaultCandidate;
  vector?: VaultSimilarityVector;
  deep?: DeepCompareResult;
  localDnaHit: LocalDnaSearchHit | null;
  localDnaScore: number;
}): CandidateScoreLog {
  const { rank, candidate, vector, deep, localDnaHit, localDnaScore } = params;
  const vectorSimilarity = vector?.scores.composite ?? candidate.compositeScore;
  const clipSimilarity = vector?.scores.clip ?? 0;
  const orbScore = vector?.scores.orb
    ?? (localDnaHit?.vaultId === candidate.vaultId ? (localDnaHit.orbRefineScore ?? 0) : 0);
  const pHashSimilarity = vector?.scores.perceptualBlend ?? vector?.scores.pHash ?? 0;
  const dnaScore = deep?.overallConfidenceScore ?? 0;
  const dnaClassification = deep?.classification ?? 'MISSING';
  const patchScore = localDnaHit?.vaultId === candidate.vaultId ? localDnaScore : 0;

  const fusionScore = imageCandidateFusionScore({
    dnaScore,
    dnaClassification,
    vectorComposite: vectorSimilarity,
    orbScore,
    pHash: pHashSimilarity,
    localPatchScore: patchScore,
  });

  const rejectReasons: string[] = [];
  if (!deep) rejectReasons.push('dna_missing');
  if (dnaScore < IMAGE_DNA_ACCEPT_MIN) rejectReasons.push(`dna_${dnaScore}<${IMAGE_DNA_ACCEPT_MIN}`);
  if (dnaClassification === 'DIFFERENT' && dnaScore < 55) {
    rejectReasons.push(`dna_DIFFERENT_${dnaScore}`);
  }
  // ORB gate only when we have an ORB reading (0 means not computed — do not auto-fail).
  if (orbScore > 0 && orbScore < IMAGE_ORB_ACCEPT_MIN) {
    rejectReasons.push(`orb_${orbScore}<${IMAGE_ORB_ACCEPT_MIN}`);
  }
  if (fusionScore < IMAGE_FUSION_ACCEPT_MIN) {
    rejectReasons.push(`fusion_${fusionScore}<${IMAGE_FUSION_ACCEPT_MIN}`);
  }

  const decision: 'ACCEPT' | 'REJECT' = rejectReasons.length === 0 ? 'ACCEPT' : 'REJECT';

  const log: CandidateScoreLog = {
    rank,
    vaultId: candidate.vaultId,
    filename: vector?.filename,
    vectorSimilarity,
    clipSimilarity,
    orbScore,
    pHashSimilarity,
    dnaScore,
    dnaClassification,
    fusionScore,
    decision,
    rejectReasons,
  };

  logger.info('[ImageCandidate] Score card', log);
  return log;
}

/**
 * Walk ranked candidates in order. First that passes DNA+ORB+fusion wins.
 * If all fail → no match (NO_SIGNATURE).
 */
export function selectAcceptedImageCandidate(params: {
  candidates: RankedVaultCandidate[];
  vectors: VaultSimilarityVector[];
  deepCompareResults: DeepCompareResult[];
  localDnaHit: LocalDnaSearchHit | null;
  localDnaScore: number;
  ownerUserId: string;
  identityHit: VaultMatchResult | null;
  isExactVaultMatch: boolean;
}): ImageAcceptanceResult {
  const logs: CandidateScoreLog[] = [];

  if (params.isExactVaultMatch && params.identityHit) {
    return {
      accepted: true,
      match: params.identityHit,
      source: 'sha256_exact',
      deepCompare: deepFor(params.identityHit.vaultId, params.deepCompareResults) ?? null,
      logs,
    };
  }

  // Tier-2 embedded identity still requires DNA confirmation when available.
  const ordered = [...params.candidates];
  if (params.identityHit && !ordered.some((c) => c.vaultId === params.identityHit!.vaultId)) {
    ordered.unshift({
      rank: 0,
      dnaRecordId: params.identityHit.dnaRecordId,
      vaultId: params.identityHit.vaultId,
      ownerUserId: params.identityHit.ownerUserId,
      preliminaryScore: 80,
      compositeScore: 80,
      tier: 2,
      method: params.identityHit.method,
      signals: ['identity_signature'],
    });
  }

  for (let i = 0; i < ordered.length; i++) {
    const candidate = ordered[i]!;
    const vector = vectorFor(candidate.vaultId, params.vectors);
    const deep = deepFor(candidate.vaultId, params.deepCompareResults);
    const log = evaluateImageCandidate({
      rank: i + 1,
      candidate,
      vector,
      deep,
      localDnaHit: params.localDnaHit,
      localDnaScore: params.localDnaScore,
    });
    logs.push(log);

    if (log.decision === 'ACCEPT' && deep) {
      const source: AuthoritativeSelectionSource =
        params.identityHit?.vaultId === candidate.vaultId
          ? 'identity_hit'
          : params.localDnaHit?.vaultId === candidate.vaultId
            ? 'local_patch'
            : deep.overallConfidenceScore >= 45
              ? 'deep_compare'
              : 'vector_top';

      logger.info('[ImageCandidate] ACCEPTED', {
        vaultId: candidate.vaultId.slice(0, 8),
        rank: i + 1,
        dnaScore: log.dnaScore,
        orbScore: log.orbScore,
        fusionScore: log.fusionScore,
        source,
      });

      return {
        accepted: true,
        match: vaultCandidateRankingService.toVaultMatch({
          ...candidate,
          compositeScore: Math.max(candidate.compositeScore, log.dnaScore, log.fusionScore),
        }),
        source,
        deepCompare: deep,
        logs,
      };
    }

    logger.warn('[ImageCandidate] REJECTED — trying next', {
      vaultId: candidate.vaultId.slice(0, 8),
      rank: i + 1,
      reasons: log.rejectReasons,
      dnaScore: log.dnaScore,
      orbScore: log.orbScore,
      fusionScore: log.fusionScore,
    });
  }

  logger.info('[ImageCandidate] All candidates rejected — NO_SIGNATURE', {
    evaluated: logs.length,
  });

  return {
    accepted: false,
    match: null,
    source: 'none',
    deepCompare: null,
    logs,
  };
}
