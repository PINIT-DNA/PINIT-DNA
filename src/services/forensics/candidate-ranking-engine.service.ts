/**
 * Candidate Ranking Engine — Phase 4
 * docs/architecture/05_EVIDENCE_GRAPH.md
 *
 * Stages candidates (Top 100 → 30 → 20 → 10), walks in order, runs Acceptance
 * Engine on each. Never stops at #1. Never keeps retrieval confidence on reject.
 * Does not change DNA/ORB algorithms — only selection order and acceptance gates.
 */
import { logger } from '../../lib/logger';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import type { VaultSimilarityVector } from './vault-similarity-vector.service';
import type { DeepCompareResult } from './deep-vault-compare.service';
import type { LocalDnaSearchHit } from './vault-local-dna-search.service';
import type { VaultMatchResult } from './vault-auto-match.service';
import type { AuthoritativeSelectionSource } from '../../types/authoritative-asset.types';
import type { AcceptanceEvidence, AcceptanceVerdict } from '../../types/acceptance.types';
import {
  runAcceptanceEngine,
  passChannel,
  failChannel,
  skippedChannel,
} from './acceptance-engine.service';
import { vaultCandidateRankingService } from './vault-candidate-ranking.service';

/** Staging caps — scalable funnel without full-vault deep compare */
export const RANKING_TOP_VECTOR = 100;
export const RANKING_TOP_IDENTITY = 30;
export const RANKING_TOP_MEDIA = 20;
export const RANKING_TOP_DEEP = 10;

const WINNING_VERDICTS: AcceptanceVerdict[] = [
  'VERIFIED_ORIGINAL',
  'VERIFIED_DERIVATIVE',
  'POSSIBLE_MATCH',
];

export interface CandidateRankingLog {
  rank: number;
  stage: 'vector' | 'identity' | 'media' | 'deep' | 'acceptance';
  vaultId: string;
  dnaRecordId: string;
  filename?: string;
  vectorSimilarity: number;
  clipSimilarity: number;
  orbScore: number;
  pHashSimilarity: number;
  dnaScore: number;
  dnaClassification: string;
  fusionScore: number;
  acceptanceVerdict: AcceptanceVerdict | 'NOT_EVALUATED';
  decision: 'ACCEPT' | 'REJECT' | 'FILTERED';
  rejectReasons: string[];
}

export interface CandidateRankingResult {
  winner: VaultMatchResult | null;
  source: AuthoritativeSelectionSource | 'none';
  deepCompare: DeepCompareResult | null;
  logs: CandidateRankingLog[];
  /** Ordered shortlist that should receive deep DNA compare */
  deepComparePool: RankedVaultCandidate[];
  stages: {
    afterVector: number;
    afterIdentity: number;
    afterMedia: number;
    afterDeepPool: number;
    evaluated: number;
  };
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
 * Stage 1–3: deterministic funnel (no deep compare yet).
 */
export function stageCandidates(params: {
  candidates: RankedVaultCandidate[];
  identityHit: VaultMatchResult | null;
  mediaType?: string;
}): RankedVaultCandidate[] {
  const sorted = [...params.candidates].sort((a, b) => b.compositeScore - a.compositeScore);

  // Top 100 vector pool
  let pool = sorted.slice(0, RANKING_TOP_VECTOR);

  // Identity filter — promote identity hit, keep top 30
  if (params.identityHit) {
    const hit = params.identityHit;
    const rest = pool.filter((c) => c.vaultId !== hit.vaultId);
    const identityRow: RankedVaultCandidate = pool.find((c) => c.vaultId === hit.vaultId) ?? {
      rank: 0,
      dnaRecordId: hit.dnaRecordId,
      vaultId: hit.vaultId,
      ownerUserId: hit.ownerUserId,
      preliminaryScore: 90,
      compositeScore: 90,
      tier: hit.tier,
      method: hit.method,
      signals: ['identity_signature'],
    };
    pool = [identityRow, ...rest].slice(0, RANKING_TOP_IDENTITY);
  } else {
    pool = pool.slice(0, RANKING_TOP_IDENTITY);
  }

  // Media filter — prefer candidates with media-aligned signals when available
  const media = (params.mediaType ?? '').toLowerCase();
  if (media === 'video' || media === 'image' || media === 'pdf') {
    const preferred = pool.filter((c) =>
      c.signals.some((s) =>
        media === 'video'
          ? /video|partial_video|keyframe/i.test(s)
          : media === 'pdf'
            ? /ocr|document|text/i.test(s)
            : /perceptual|local_feature|orb|structural|identity/i.test(s),
      ),
    );
    if (preferred.length >= 3) {
      const preferredIds = new Set(preferred.map((c) => c.vaultId));
      const rest = pool.filter((c) => !preferredIds.has(c.vaultId));
      pool = [...preferred, ...rest].slice(0, RANKING_TOP_MEDIA);
    } else {
      pool = pool.slice(0, RANKING_TOP_MEDIA);
    }
  } else {
    pool = pool.slice(0, RANKING_TOP_MEDIA);
  }

  return pool.map((c, i) => ({ ...c, rank: i + 1 }));
}

function evidenceForCandidate(params: {
  candidate: RankedVaultCandidate;
  vector?: VaultSimilarityVector;
  deep?: DeepCompareResult;
  localDnaHit: LocalDnaSearchHit | null;
  localDnaScore: number;
  certificateId?: string | null;
  isExactMatch: boolean;
}): AcceptanceEvidence {
  const { candidate, vector, deep, localDnaHit, localDnaScore, certificateId, isExactMatch } = params;

  const dnaScore = isExactMatch
    ? 100
    : (deep?.overallConfidenceScore ?? 0);
  const classification = isExactMatch
    ? 'DNA_MATCH'
    : (deep?.classification ?? 'MISSING');

  let dnaState: AcceptanceEvidence['dna'];
  if (isExactMatch) {
    dnaState = { ...passChannel(100, 'SHA-256 exact'), classification: 'DNA_MATCH' };
  } else if (!deep) {
    dnaState = { ...failChannel(0, 'No DNA compare'), classification: 'MISSING' };
  } else if (classification.toUpperCase() === 'DIFFERENT' && dnaScore < 55) {
    dnaState = { ...failChannel(dnaScore, classification), classification };
  } else if (dnaScore >= 40) {
    dnaState = { ...passChannel(dnaScore, classification), classification };
  } else {
    dnaState = { ...failChannel(dnaScore, classification), classification };
  }

  const orb = vector?.scores.orb
    ?? (localDnaHit?.vaultId === candidate.vaultId ? localDnaHit.orbRefineScore : 0)
    ?? 0;
  const pHash = vector?.scores.perceptualBlend ?? vector?.scores.pHash ?? 0;
  const composite = vector?.scores.composite ?? candidate.compositeScore;
  const patch = localDnaHit?.vaultId === candidate.vaultId ? localDnaScore : 0;
  const visualScore = Math.max(orb, pHash, composite, patch);

  const tamperDetected = !!(deep?.tamperingDetected)
    || (dnaScore > 0 && dnaScore < 95 && dnaScore >= 40);

  return {
    analysisComplete: true,
    hasCandidate: true,
    vaultId: candidate.vaultId,
    dnaRecordId: candidate.dnaRecordId,
    ownerUserId: candidate.ownerUserId,
    dna: dnaState,
    certificate: certificateId
      ? passChannel(100, certificateId)
      : skippedChannel('No certificate on file'),
    vault: passChannel(100, candidate.vaultId),
    owner: candidate.ownerUserId
      ? passChannel(80, candidate.ownerUserId)
      : failChannel(0, 'Owner not bound'),
    timeline: candidate.dnaRecordId
      ? passChannel(100, 'DNA registration present')
      : failChannel(0, 'No timeline custody link'),
    visual: visualScore > 0
      ? passChannel(visualScore)
      : failChannel(0, 'No visual evidence'),
    watermark: failChannel(0, 'Watermark not evaluated per-candidate'),
    metadata: skippedChannel('Metadata not evaluated per-candidate'),
    tamperDetected,
  };
}

/**
 * Walk staged candidates. First that wins Acceptance Engine is the winner.
 * Rejected candidates are permanently discarded (retrieval confidence not reused).
 */
export function selectWinnerByRanking(params: {
  candidates: RankedVaultCandidate[];
  vectors: VaultSimilarityVector[];
  deepCompareResults: DeepCompareResult[];
  localDnaHit: LocalDnaSearchHit | null;
  localDnaScore: number;
  identityHit: VaultMatchResult | null;
  isExactVaultMatch: boolean;
  mediaType?: string;
  /** Optional cert ids by vault */
  certificateByVaultId?: Map<string, string>;
}): CandidateRankingResult {
  const logs: CandidateRankingLog[] = [];

  if (params.isExactVaultMatch && params.identityHit) {
    logs.push({
      rank: 1,
      stage: 'acceptance',
      vaultId: params.identityHit.vaultId,
      dnaRecordId: params.identityHit.dnaRecordId,
      vectorSimilarity: 100,
      clipSimilarity: 100,
      orbScore: 100,
      pHashSimilarity: 100,
      dnaScore: 100,
      dnaClassification: 'DNA_MATCH',
      fusionScore: 100,
      acceptanceVerdict: 'VERIFIED_ORIGINAL',
      decision: 'ACCEPT',
      rejectReasons: [],
    });
    return {
      winner: params.identityHit,
      source: 'sha256_exact',
      deepCompare: deepFor(params.identityHit.vaultId, params.deepCompareResults) ?? null,
      logs,
      deepComparePool: params.candidates.slice(0, 1),
      stages: {
        afterVector: 1,
        afterIdentity: 1,
        afterMedia: 1,
        afterDeepPool: 1,
        evaluated: 1,
      },
    };
  }

  const staged = stageCandidates({
    candidates: params.candidates,
    identityHit: params.identityHit,
    mediaType: params.mediaType,
  });

  const afterVector = Math.min(params.candidates.length, RANKING_TOP_VECTOR);
  const afterIdentity = Math.min(staged.length, RANKING_TOP_IDENTITY);
  const afterMedia = staged.length;
  const deepPool = staged.slice(0, RANKING_TOP_DEEP);

  let evaluated = 0;

  for (let i = 0; i < deepPool.length; i++) {
    const candidate = deepPool[i]!;
    const vector = vectorFor(candidate.vaultId, params.vectors);
    const deep = deepFor(candidate.vaultId, params.deepCompareResults);
    const isExact = params.isExactVaultMatch
      && params.identityHit?.vaultId === candidate.vaultId;

    // Hard reject: DNA DIFFERENT / low DNA — never accept via similarity alone
    const dnaScore = deep?.overallConfidenceScore ?? 0;
    const dnaClass = deep?.classification ?? 'MISSING';
    if (!isExact && (!deep || (dnaClass.toUpperCase() === 'DIFFERENT' && dnaScore < 42) || dnaScore < 40)) {
      evaluated++;
      const reasons = !deep
        ? ['dna_missing']
        : [`dna_${dnaScore}_${dnaClass}`];
      logs.push({
        rank: i + 1,
        stage: 'acceptance',
        vaultId: candidate.vaultId,
        dnaRecordId: candidate.dnaRecordId,
        filename: vector?.filename,
        vectorSimilarity: vector?.scores.composite ?? candidate.compositeScore,
        clipSimilarity: vector?.scores.clip ?? 0,
        orbScore: vector?.scores.orb ?? 0,
        pHashSimilarity: vector?.scores.perceptualBlend ?? 0,
        dnaScore,
        dnaClassification: dnaClass,
        fusionScore: 0,
        acceptanceVerdict: 'NOT_PINIT',
        decision: 'REJECT',
        rejectReasons: reasons,
      });
      logger.warn('[CandidateRanking] REJECTED — DNA gate', {
        rank: i + 1,
        vaultId: candidate.vaultId.slice(0, 8),
        dnaScore,
        dnaClass,
        vectorSimilarity: vector?.scores.composite ?? candidate.compositeScore,
      });
      continue;
    }

    const evidence = evidenceForCandidate({
      candidate,
      vector,
      deep,
      localDnaHit: params.localDnaHit,
      localDnaScore: params.localDnaScore,
      certificateId: params.certificateByVaultId?.get(candidate.vaultId),
      isExactMatch: !!isExact,
    });

    const decision = runAcceptanceEngine(evidence);
    evaluated++;

    const log: CandidateRankingLog = {
      rank: i + 1,
      stage: 'acceptance',
      vaultId: candidate.vaultId,
      dnaRecordId: candidate.dnaRecordId,
      filename: vector?.filename,
      vectorSimilarity: vector?.scores.composite ?? candidate.compositeScore,
      clipSimilarity: vector?.scores.clip ?? 0,
      orbScore: vector?.scores.orb ?? 0,
      pHashSimilarity: vector?.scores.perceptualBlend ?? 0,
      dnaScore: evidence.dna.score,
      dnaClassification: evidence.dna.classification ?? 'MISSING',
      fusionScore: decision.confidence,
      acceptanceVerdict: decision.verdict,
      decision: WINNING_VERDICTS.includes(decision.verdict) ? 'ACCEPT' : 'REJECT',
      rejectReasons: WINNING_VERDICTS.includes(decision.verdict)
        ? []
        : [decision.verdict, decision.decisionReason],
    };
    logs.push(log);

    if (log.decision === 'ACCEPT') {
      const source: AuthoritativeSelectionSource =
        params.identityHit?.vaultId === candidate.vaultId
          ? (params.isExactVaultMatch ? 'sha256_exact' : 'identity_hit')
          : params.localDnaHit?.vaultId === candidate.vaultId
            ? 'local_patch'
            : deep && deep.overallConfidenceScore >= 45
              ? 'deep_compare'
              : 'vector_top';

      logger.info('[CandidateRanking] WINNER', {
        rank: i + 1,
        vaultId: candidate.vaultId.slice(0, 8),
        verdict: decision.verdict,
        confidence: decision.confidence,
        dnaScore: log.dnaScore,
        source,
      });

      return {
        winner: vaultCandidateRankingService.toVaultMatch({
          ...candidate,
          compositeScore: Math.max(
            candidate.compositeScore,
            log.dnaScore,
            decision.confidence,
          ),
        }),
        source,
        deepCompare: deep ?? null,
        logs,
        deepComparePool: deepPool,
        stages: {
          afterVector,
          afterIdentity,
          afterMedia,
          afterDeepPool: deepPool.length,
          evaluated,
        },
      };
    }

    logger.warn('[CandidateRanking] REJECTED — trying next', {
      rank: i + 1,
      vaultId: candidate.vaultId.slice(0, 8),
      verdict: decision.verdict,
      reasons: log.rejectReasons,
      dnaScore: log.dnaScore,
      vectorSimilarity: log.vectorSimilarity,
    });
  }

  logger.info('[CandidateRanking] All candidates rejected', {
    evaluated,
    deepPool: deepPool.length,
  });

  return {
    winner: null,
    source: 'none',
    deepCompare: null,
    logs,
    deepComparePool: deepPool,
    stages: {
      afterVector,
      afterIdentity,
      afterMedia,
      afterDeepPool: deepPool.length,
      evaluated,
    },
  };
}

/** Map ranking logs to manifest candidate entries */
export function rankingLogsToManifestCandidates(logs: CandidateRankingLog[]) {
  return logs.map((l) => ({
    rank: l.rank,
    vaultId: l.vaultId,
    dnaRecordId: l.dnaRecordId,
    filename: l.filename,
    vectorSimilarity: l.vectorSimilarity,
    clipSimilarity: l.clipSimilarity,
    orbScore: l.orbScore,
    pHashSimilarity: l.pHashSimilarity,
    dnaScore: l.dnaScore,
    dnaClassification: l.dnaClassification,
    fusionScore: l.fusionScore,
    decision: l.decision === 'FILTERED' ? 'REJECT' as const : l.decision,
    rejectReasons: l.rejectReasons,
  }));
}
