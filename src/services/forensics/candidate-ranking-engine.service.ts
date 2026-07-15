/**
 * Candidate Ranking Engine — Phase 4
 * docs/architecture/05_EVIDENCE_GRAPH.md
 *
 * Staging thresholds from investigation-match-policy.ts (v1.2).
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
import {
  LOCAL_PATCH_RESCUE_MIN,
  NOT_FOUND_MAX_WITHOUT_PATCH,
  POSSIBLE_L3_MIN_WITHOUT_PATCH,
  POSSIBLE_MIN,
  RANKING_L3_PERCEPTUAL_MIN,
  RANKING_LIVE_LEAD_MIN,
  RANKING_TOP_DEEP,
  RANKING_TOP_DEEP_STRONG_LEAD,
  RANKING_TOP_IDENTITY,
  RANKING_TOP_MEDIA,
  RANKING_TOP_VECTOR,
  RANKING_TRUSTED_LEAD_MIN,
} from '../../config/investigation-match-policy';

/** Re-export policy constants for tests / callers */
export {
  RANKING_TOP_VECTOR,
  RANKING_TOP_IDENTITY,
  RANKING_TOP_MEDIA,
  RANKING_TOP_DEEP,
  RANKING_TOP_DEEP_STRONG_LEAD,
  RANKING_L3_PERCEPTUAL_MIN,
  RANKING_LIVE_LEAD_MIN,
  RANKING_TRUSTED_LEAD_MIN,
  LOCAL_PATCH_RESCUE_MIN,
};
/** Alias used in ranking POSSIBLE L3 gate */
export const RANKING_POSSIBLE_L3_MIN = POSSIBLE_L3_MIN_WITHOUT_PATCH;

/**
 * Comparison lock may stop on POSSIBLE_MATCH (Top Candidates / DNA vs vault).
 * Ownership revelation is gated later by Acceptance retainCandidate (VERIFIED only).
 */
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
  /** All deep DNA results produced during the walk */
  allDeepResults: DeepCompareResult[];
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
  // Always keep identity hit at index 0 when present (forensic tile must not be reordered away).
  const media = (params.mediaType ?? '').toLowerCase();
  const identityId = params.identityHit?.vaultId;
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

  if (identityId) {
    const hit = pool.find((c) => c.vaultId === identityId);
    if (hit) {
      pool = [hit, ...pool.filter((c) => c.vaultId !== identityId)];
    }
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

  const patchRescue = !!(
    localDnaHit
    && localDnaHit.vaultId === candidate.vaultId
    && localDnaScore >= LOCAL_PATCH_RESCUE_MIN
  );
  const deepScore = deep?.overallConfidenceScore ?? 0;
  // Heavy crop/compress: full-frame DNA often <40% even on the true vault —
  // local patch votes are the fragment identity signal.
  const dnaScore = isExactMatch
    ? 100
    : patchRescue
      ? Math.max(deepScore, localDnaScore)
      : deepScore;
  const classification = isExactMatch
    ? 'DNA_MATCH'
    : patchRescue && deepScore < 40
      ? 'SIMILAR'
      : (deep?.classification ?? (patchRescue ? 'SIMILAR' : 'MISSING'));

  let dnaState: AcceptanceEvidence['dna'];
  if (isExactMatch) {
    dnaState = { ...passChannel(100, 'SHA-256 exact'), classification: 'DNA_MATCH' };
  } else if (patchRescue && dnaScore >= LOCAL_PATCH_RESCUE_MIN) {
    dnaState = {
      ...passChannel(dnaScore, `local_patch_${localDnaHit!.patchMatchCount}`),
      classification,
    };
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

  // Fragment/crop lock is always a derivative vs vault original.
  const tamperDetected = isExactMatch
    ? false
    : patchRescue
      || (!!(deep?.tamperingDetected)
        && dnaScore >= 72
        && (dnaScore + visualScore) / 2 >= 62
        && visualScore >= 55);

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
    // Retrieval + vault row ownerUserId is NOT ownership proof
    owner: certificateId
      ? passChannel(100, certificateId)
      : failChannel(0, 'Owner not cryptographically bound'),
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
 * Walk staged candidates:
 * deep DNA (live vault bytes) → L3 perceptual / metadata gates → Acceptance.
 * Evaluates the full deep pool and picks the best DNA winner — does NOT stop at
 * the first POSSIBLE_MATCH (that caused DigiMark → wrong SEO-phone vault).
 */
export async function selectWinnerByRanking(params: {
  candidates: RankedVaultCandidate[];
  vectors: VaultSimilarityVector[];
  /** Precomputed deep results (optional). Prefer compareCandidate for walk. */
  deepCompareResults?: DeepCompareResult[];
  /** Per-candidate deep DNA — used when present so results are never lost to batch timeout */
  compareCandidate?: (candidate: RankedVaultCandidate) => Promise<DeepCompareResult | null>;
  localDnaHit: LocalDnaSearchHit | null;
  localDnaScore: number;
  identityHit: VaultMatchResult | null;
  isExactVaultMatch: boolean;
  mediaType?: string;
  certificateByVaultId?: Map<string, string>;
}): Promise<CandidateRankingResult> {
  const logs: CandidateRankingLog[] = [];
  const deepResults: DeepCompareResult[] = [...(params.deepCompareResults ?? [])];

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
      deepCompare: deepFor(params.identityHit.vaultId, deepResults) ?? null,
      allDeepResults: deepResults,
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
  const topScore = staged[0]?.compositeScore ?? 0;
  const trustedLead = !!params.identityHit || topScore >= RANKING_TRUSTED_LEAD_MIN;
  const deepLimit = trustedLead ? RANKING_TOP_DEEP_STRONG_LEAD : RANKING_TOP_DEEP;
  let deepPool = staged.slice(0, deepLimit);

  if (params.localDnaHit && params.localDnaScore >= LOCAL_PATCH_RESCUE_MIN) {
    const lid = params.localDnaHit.vaultId;
    const patchRow = staged.find((c) => c.vaultId === lid)
      ?? params.candidates.find((c) => c.vaultId === lid);
    if (patchRow) {
      deepPool = [patchRow, ...deepPool.filter((c) => c.vaultId !== lid)].slice(0, deepLimit + 1);
    }
  }

  // Ensure forensic identity vault is always in the DNA compare pool
  if (params.identityHit) {
    const id = params.identityHit.vaultId;
    if (!deepPool.some((c) => c.vaultId === id)) {
      const row = staged.find((c) => c.vaultId === id)
        ?? params.candidates.find((c) => c.vaultId === id);
      if (row) deepPool = [row, ...deepPool].slice(0, deepLimit + 1);
    }
  }

  let evaluated = 0;
  type RankAccept = {
    candidate: RankedVaultCandidate;
    deep: DeepCompareResult | null;
    decision: ReturnType<typeof runAcceptanceEngine>;
    log: CandidateRankingLog;
    l3: number;
    isIdentity: boolean;
    isLocalPatch: boolean;
  };
  const accepted: RankAccept[] = [];

  if (params.compareCandidate) {
    const needsDeep = deepPool.filter((candidate) => {
      if (deepFor(candidate.vaultId, deepResults)) return false;
      const isExact = params.isExactVaultMatch
        && params.identityHit?.vaultId === candidate.vaultId;
      return !isExact;
    });
    if (needsDeep.length > 0) {
      const parallelDeep = await Promise.all(
        needsDeep.map(async (candidate) => params.compareCandidate!(candidate)),
      );
      for (const deep of parallelDeep) {
        if (deep) deepResults.push(deep);
      }
    }
  }

  for (let i = 0; i < deepPool.length; i++) {
    const candidate = deepPool[i]!;
    const vector = vectorFor(candidate.vaultId, params.vectors);
    const isExact = params.isExactVaultMatch
      && params.identityHit?.vaultId === candidate.vaultId;
    const isLocalPatchHit = !!(
      params.localDnaHit
      && params.localDnaHit.vaultId === candidate.vaultId
      && params.localDnaScore >= LOCAL_PATCH_RESCUE_MIN
    );

    let deep = deepFor(candidate.vaultId, deepResults);
    if (!deep && !isExact && params.compareCandidate) {
      deep = (await params.compareCandidate(candidate)) ?? undefined;
      if (deep) deepResults.push(deep);
    }

    const dnaScore = deep?.overallConfidenceScore ?? 0;
    const dnaClass = deep?.classification ?? 'MISSING';
    const l3 = deep?.layerComparisons?.find((l) => l.layer === 3)?.similarityPercent ?? 0;
    const l5 = deep?.layerComparisons?.find((l) => l.layer === 5)?.similarityPercent ?? 0;
    const vectorVis = Math.max(
      vector?.scores.orb ?? 0,
      vector?.scores.perceptualBlend ?? vector?.scores.pHash ?? 0,
      vector?.scores.composite ?? 0,
    );
    const isIdentityCandidate = !!(
      params.identityHit
      && params.identityHit.vaultId === candidate.vaultId
    );

    const pushReject = (reasons: string[], verdict: AcceptanceVerdict = 'NOT_PINIT') => {
      evaluated++;
      logs.push({
        rank: i + 1,
        stage: 'acceptance',
        vaultId: candidate.vaultId,
        dnaRecordId: candidate.dnaRecordId,
        filename: vector?.filename,
        vectorSimilarity: vector?.scores.composite ?? candidate.compositeScore,
        clipSimilarity: vector?.scores.clip ?? 0,
        orbScore: vector?.scores.orb ?? 0,
        pHashSimilarity: vector?.scores.perceptualBlend ?? l3 ?? 0,
        dnaScore,
        dnaClassification: dnaClass,
        fusionScore: 0,
        acceptanceVerdict: verdict,
        decision: 'REJECT',
        rejectReasons: reasons,
      });
    };

    // Hard refuse: DNA says DIFFERENT subjects.
    // Local-patch hits skip this gate — full-frame L3 collapses on true crops while
    // fragment votes are the real identity signal (evidenceForCandidate rewrites class).
    if (
      !isExact
      && !isLocalPatchHit
      && dnaClass.toUpperCase() === 'DIFFERENT'
      && !(isIdentityCandidate && l3 >= 70)
    ) {
      pushReject([`dna_different_l3_${Math.round(l3)}`]);
      logger.warn('[CandidateRanking] REJECTED — DNA DIFFERENT (layer compare)', {
        vaultId: candidate.vaultId.slice(0, 8),
        dnaScore,
        l3,
      });
      continue;
    }

    // Hard refuse: weak perceptual hash for non-identity lookalikes.
    // Only enforce when L3 was actually measured — missing layers must not
    // auto-reject SIMILAR/DNA_MATCH scores (common in unit tests + timed-out compares).
    const hasMeasuredL3 = !!deep?.layerComparisons?.some((l) => l.layer === 3);
    if (
      !isExact
      && !isIdentityCandidate
      && !isLocalPatchHit
      && deep
      && hasMeasuredL3
      && l3 < RANKING_L3_PERCEPTUAL_MIN
    ) {
      pushReject([`l3_perceptual_${Math.round(l3)}_below_${RANKING_L3_PERCEPTUAL_MIN}`]);
      logger.warn('[CandidateRanking] REJECTED — weak L3 perceptual', {
        vaultId: candidate.vaultId.slice(0, 8),
        l3,
        dnaScore,
      });
      continue;
    }

    if (
      !isExact
      && !isLocalPatchHit
      && !isIdentityCandidate
      && (!deep || dnaScore < 40)
      && vectorVis < 75
    ) {
      pushReject(!deep ? ['dna_missing_or_decrypt_failed'] : [`dna_${dnaScore}_${dnaClass}`]);
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
    // Prefer live L3 / L5 from deep DNA over vector-only visual
    if (l3 > 0) {
      evidence.visual = passChannel(Math.max(l3, evidence.visual.score), `L3_perceptual_${Math.round(l3)}`);
    }
    if (l5 > 0) {
      evidence.metadata = passChannel(l5, `L5_metadata_${Math.round(l5)}`);
    }

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
      pHashSimilarity: Math.max(vector?.scores.perceptualBlend ?? 0, l3),
      dnaScore: evidence.dna.score,
      dnaClassification: evidence.dna.classification ?? 'MISSING',
      fusionScore: decision.confidence,
      acceptanceVerdict: decision.verdict,
      decision: WINNING_VERDICTS.includes(decision.verdict) ? 'ACCEPT' : 'REJECT',
      rejectReasons: WINNING_VERDICTS.includes(decision.verdict)
        ? []
        : [decision.verdict, decision.decisionReason],
    };

    if (
      log.decision === 'ACCEPT'
      && decision.verdict === 'POSSIBLE_MATCH'
      && params.identityHit
      && !isIdentityCandidate
      && !isLocalPatchHit
      && !isExact
    ) {
      log.decision = 'REJECT';
      log.rejectReasons = [
        'identity_hit_priority',
        `forensic_vault_${params.identityHit.vaultId.slice(0, 8)}_blocks_possible_lookalike`,
      ];
      logs.push(log);
      continue;
    }

    if (
      log.decision === 'ACCEPT'
      && decision.verdict === 'POSSIBLE_MATCH'
      && !isLocalPatchHit
      && !isExact
      && (
        dnaClass.toUpperCase() === 'DIFFERENT'
        || (hasMeasuredL3 && l3 < RANKING_POSSIBLE_L3_MIN)
        || dnaScore < NOT_FOUND_MAX_WITHOUT_PATCH
        || dnaScore < POSSIBLE_MIN
      )
    ) {
      log.decision = 'REJECT';
      log.rejectReasons = [`possible_needs_dna_l3_got_dna${dnaScore}_l3${Math.round(l3)}`];
      logs.push(log);
      continue;
    }

    logs.push(log);

    if (log.decision === 'ACCEPT') {
      accepted.push({
        candidate,
        deep: deep ?? null,
        decision,
        log,
        l3,
        isIdentity: isIdentityCandidate,
        isLocalPatch: isLocalPatchHit,
      });
    } else {
      logger.warn('[CandidateRanking] REJECTED — trying next', {
        rank: i + 1,
        vaultId: candidate.vaultId.slice(0, 8),
        verdict: decision.verdict,
        reasons: log.rejectReasons,
        dnaScore: log.dnaScore,
        l3,
      });
    }
  }

  const stages = {
    afterVector,
    afterIdentity,
    afterMedia,
    afterDeepPool: deepPool.length,
    evaluated,
  };

  if (accepted.length > 0) {
    // Prefer VERIFIED_* then local-patch crop hits, then highest DNA / L3
    const rankVerdict = (v: AcceptanceVerdict) => (
      v === 'VERIFIED_ORIGINAL' ? 3 : v === 'VERIFIED_DERIVATIVE' ? 2 : 1
    );
    accepted.sort((a, b) => {
      const vd = rankVerdict(b.decision.verdict) - rankVerdict(a.decision.verdict);
      if (vd !== 0) return vd;
      // True crop fragment beats a higher full-frame lookalike DNA score
      if (a.isLocalPatch !== b.isLocalPatch) return a.isLocalPatch ? -1 : 1;
      if (a.isIdentity !== b.isIdentity) return a.isIdentity ? -1 : 1;
      const dna = b.log.dnaScore - a.log.dnaScore;
      if (dna !== 0) return dna;
      return b.l3 - a.l3;
    });

    // If a lookalike won POSSIBLE but a local-patch candidate was also accepted, force patch.
    // If patch was rejected solely for DIFFERENT DNA, revive it below after empty accepted —
    // here we only re-rank accepted.
    const best = accepted[0]!;
    // Guard: non-patch POSSIBLE with mid L3 should not have been accepted — double-check.
    if (
      !best.isLocalPatch
      && !best.isIdentity
      && best.decision.verdict === 'POSSIBLE_MATCH'
      && best.l3 > 0
      && best.l3 < RANKING_POSSIBLE_L3_MIN
      && params.localDnaHit
      && params.localDnaScore >= LOCAL_PATCH_RESCUE_MIN
    ) {
      const patchAccepted = accepted.find((a) => a.isLocalPatch);
      if (patchAccepted) {
        accepted[0] = patchAccepted;
      }
    }
    const winner = accepted[0]!;

    // Prefer local-patch true-crop vault over a higher full-frame lookalike POSSIBLE.
    if (
      params.localDnaHit
      && params.localDnaScore >= LOCAL_PATCH_RESCUE_MIN
      && winner.candidate.vaultId !== params.localDnaHit.vaultId
      && (winner.decision.verdict === 'POSSIBLE_MATCH' || winner.log.dnaScore < 80)
    ) {
      const patchAccepted = accepted.find((a) => a.candidate.vaultId === params.localDnaHit!.vaultId);
      const patchRow = patchAccepted?.candidate
        ?? deepPool.find((c) => c.vaultId === params.localDnaHit!.vaultId)
        ?? params.candidates.find((c) => c.vaultId === params.localDnaHit!.vaultId);
      const patchDeep = deepFor(params.localDnaHit.vaultId, deepResults);
      if (patchRow) {
        logger.warn('[CandidateRanking] Preferring local-patch crop over lookalike DNA lead', {
          lookalikeVault: winner.candidate.vaultId.slice(0, 8),
          lookalikeDna: winner.log.dnaScore,
          patchVault: params.localDnaHit.vaultId.slice(0, 8),
          localDnaScore: params.localDnaScore,
        });
        const baseMatch = vaultCandidateRankingService.toVaultMatch(patchRow);
        return {
          winner: {
            ...baseMatch,
            method: `${patchRow.method} (local_patch preferred over lookalike ${winner.log.dnaScore}%)`,
            confidence: String(Math.max(
              params.localDnaScore,
              patchDeep?.overallConfidenceScore ?? 0,
              patchAccepted?.log.dnaScore ?? 0,
              patchRow.compositeScore,
            )),
          },
          source: 'local_patch',
          deepCompare: patchAccepted?.deep ?? patchDeep ?? null,
          allDeepResults: deepResults,
          logs,
          deepComparePool: deepPool,
          stages,
        };
      }
    }

    const source: AuthoritativeSelectionSource =
      params.identityHit?.vaultId === winner.candidate.vaultId
        ? (params.isExactVaultMatch ? 'sha256_exact' : 'identity_hit')
        : params.localDnaHit?.vaultId === winner.candidate.vaultId
          ? 'local_patch'
          : winner.deep && winner.deep.overallConfidenceScore >= 45
            ? 'deep_compare'
            : 'vector_top';

    logger.info('[CandidateRanking] WINNER (best DNA across pool)', {
      vaultId: winner.candidate.vaultId.slice(0, 8),
      verdict: winner.decision.verdict,
      dnaScore: winner.log.dnaScore,
      l3: winner.l3,
      compared: accepted.length,
      source,
      localPatchPreferred: winner.isLocalPatch,
    });

    const dnaPart = winner.log.dnaScore > 0 ? `, DNA ${winner.log.dnaScore}%` : '';
    const l3Part = winner.l3 > 0 ? `, L3 ${Math.round(winner.l3)}%` : '';
    const baseMatch = vaultCandidateRankingService.toVaultMatch(winner.candidate);
    return {
      winner: {
        ...baseMatch,
        method: `${winner.candidate.method} (rank #${winner.candidate.rank}, vector ${winner.candidate.compositeScore}%${dnaPart}${l3Part})`,
        confidence: String(Math.max(winner.candidate.compositeScore, winner.log.dnaScore || 0, winner.l3)),
      },
      source,
      deepCompare: winner.deep,
      allDeepResults: deepResults,
      logs,
      deepComparePool: deepPool,
      stages,
    };
  }

  if (params.identityHit) {
    const identityDeep = deepFor(params.identityHit.vaultId, deepResults);
    const identityDna = identityDeep?.overallConfidenceScore ?? 0;
    const identityClass = (identityDeep?.classification ?? '').toUpperCase();
    const identityL3 = identityDeep?.layerComparisons?.find((l) => l.layer === 3)?.similarityPercent ?? 0;
    const identityHardFail = identityClass === 'DIFFERENT' && identityL3 < 40 && identityDna < 40;
    if (!identityHardFail) {
      logger.info('[CandidateRanking] Retaining identity hit after DNA walk', {
        vaultId: params.identityHit.vaultId.slice(0, 8),
        dnaScore: identityDna,
        l3: identityL3,
      });
      return {
        winner: params.identityHit,
        source: params.isExactVaultMatch ? 'sha256_exact' : 'identity_hit',
        deepCompare: identityDeep ?? null,
        allDeepResults: deepResults,
        logs,
        deepComparePool: deepPool,
        stages,
      };
    }
  }

  // Heavy crop fallback: keep local-patch vault even when acceptance stayed NOT_PINIT
  // (full-frame DNA DIFFERENT is expected for small WhatsApp/crops).
  if (params.localDnaHit && params.localDnaScore >= LOCAL_PATCH_RESCUE_MIN) {
    const patchDeep = deepFor(params.localDnaHit.vaultId, deepResults);
    const patchRow = deepPool.find((c) => c.vaultId === params.localDnaHit!.vaultId)
      ?? params.candidates.find((c) => c.vaultId === params.localDnaHit!.vaultId);
    if (patchRow) {
      logger.info('[CandidateRanking] Retaining local-patch crop hit after DNA walk', {
        vaultId: params.localDnaHit.vaultId.slice(0, 8),
        localDnaScore: params.localDnaScore,
        dnaScore: patchDeep?.overallConfidenceScore ?? 0,
      });
      const baseMatch = vaultCandidateRankingService.toVaultMatch(patchRow);
      return {
        winner: {
          ...baseMatch,
          method: `${patchRow.method} (local_patch rescue ${params.localDnaScore}%)`,
          confidence: String(Math.max(
            params.localDnaScore,
            patchDeep?.overallConfidenceScore ?? 0,
            patchRow.compositeScore,
          )),
        },
        source: 'local_patch',
        deepCompare: patchDeep ?? null,
        allDeepResults: deepResults,
        logs,
        deepComparePool: deepPool,
        stages,
      };
    }
  }

  logger.info('[CandidateRanking] All candidates rejected', {
    evaluated,
    deepPool: deepPool.length,
  });

  return {
    winner: null,
    source: 'none',
    deepCompare: null,
    allDeepResults: deepResults,
    logs,
    deepComparePool: deepPool,
    stages,
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
