/**
 * Investigation decision resolver — maps Acceptance Engine output to report fields.
 * Final verdict authority: acceptance-engine.service.ts only.
 *
 * Ownership (candidate retained) ONLY when Acceptance returns VERIFIED_*.
 * POSSIBLE_MATCH keeps confidence for Top Candidates — never retains owner.
 */
import { logger } from '../../lib/logger';
import type { EnterpriseRecoveryResult } from './enterprise-recovery-pipeline.service';
import type { VaultMatchResult } from './vault-auto-match.service';
import type { ForensicVerdict } from './confidence-fusion-engine.service';
import type {
  AcceptanceDecision,
  AcceptanceScorecard,
  AcceptanceVerdict,
} from '../../types/acceptance.types';
import { runAcceptanceEngine, ACCEPTANCE_VERDICT_LABELS } from './acceptance-engine.service';
import { buildAcceptanceEvidenceFromEnterprise } from './acceptance-evidence.builder';
import { logInvestigationScores } from './investigation-score-logger';
import type { DnaComparisonResult } from '../../types/comparison.types';
import { sanitizeInvestigationError } from '../../lib/sanitize-investigation-error';

/** Legacy three-state UI mapping (aligned with ownership verdicts). */
export type InvestigationReportState = 'VERIFIED' | 'POSSIBLE' | 'NO_SIGNATURE';

export const REPORT_STATE_LABELS: Record<InvestigationReportState, string> = {
  VERIFIED: 'Ownership Verified',
  POSSIBLE: 'Possible Similarity – Top Candidates Only',
  NO_SIGNATURE: 'Unknown Asset',
};

export interface InvestigationOutcome {
  state: InvestigationReportState;
  candidate: VaultMatchResult | null;
  retrievalConfidence: number;
  forensicVerdict: ForensicVerdict;
  displayLabel: string;
  decisionReason: string;
  /** Frozen acceptance verdict — sole decision authority */
  acceptanceVerdict: AcceptanceVerdict;
  acceptancePolicyVersion: string;
  dnaAlgorithmVersion: string;
  acceptanceConfidence: number;
  /** Frozen scorecard from Acceptance Engine */
  acceptanceScorecard: AcceptanceScorecard;
}

/**
 * Authoritative candidate — ONLY from enterprise authoritativeAsset.
 * Presence here = retrieval/DNA comparison target — NOT ownership until Acceptance verifies.
 */
export function resolveAuthoritativeCandidate(
  enterprise: EnterpriseRecoveryResult,
): VaultMatchResult | null {
  if (enterprise.authoritativeAsset) {
    return enterprise.authoritativeAsset.match;
  }
  if (enterprise.verifiedCandidate) {
    return enterprise.verifiedCandidate;
  }
  if (enterprise.identified && enterprise.match) {
    return enterprise.match;
  }
  if (enterprise.probableMatch) {
    return enterprise.probableMatch;
  }
  return null;
}

export function mapAcceptanceToReportState(verdict: AcceptanceVerdict): InvestigationReportState {
  switch (verdict) {
    case 'VERIFIED_ORIGINAL':
    case 'VERIFIED_DERIVATIVE':
      return 'VERIFIED';
    case 'POSSIBLE_MATCH':
      return 'POSSIBLE';
    case 'NOT_PINIT':
    case 'INSUFFICIENT_EVIDENCE':
    default:
      return 'NO_SIGNATURE';
  }
}

export function mapAcceptanceToForensicVerdict(
  verdict: AcceptanceVerdict,
): ForensicVerdict {
  switch (verdict) {
    case 'VERIFIED_ORIGINAL':
      return 'ORIGINAL_VERIFIED';
    case 'VERIFIED_DERIVATIVE':
      return 'ORIGINAL_FOUND_PARTIAL';
    case 'POSSIBLE_MATCH':
      return 'POSSIBLE_ASSET';
    case 'NOT_PINIT':
    case 'INSUFFICIENT_EVIDENCE':
    default:
      return 'NO_SIGNATURE';
  }
}

function outcomeFromAcceptance(
  decision: AcceptanceDecision,
  candidate: VaultMatchResult | null,
): InvestigationOutcome {
  // Owner-bearing candidate retained ONLY when Acceptance explicitly verified ownership
  const retain = decision.retainCandidate ? candidate : null;
  return {
    state: mapAcceptanceToReportState(decision.verdict),
    candidate: retain,
    retrievalConfidence: decision.retrievalConfidence,
    forensicVerdict: mapAcceptanceToForensicVerdict(decision.verdict),
    displayLabel: decision.displayLabel,
    decisionReason: decision.decisionReason,
    acceptanceVerdict: decision.verdict,
    acceptancePolicyVersion: decision.acceptancePolicyVersion,
    dnaAlgorithmVersion: decision.dnaAlgorithmVersion,
    acceptanceConfidence: decision.confidence,
    acceptanceScorecard: decision.scorecard,
  };
}

/**
 * Derive report outcome — verdict comes ONLY from Acceptance Engine.
 */
export function deriveInvestigationOutcome(
  enterprise: EnterpriseRecoveryResult,
  options?: { analysisComplete?: boolean; failureReason?: string },
): InvestigationOutcome {
  const candidate = resolveAuthoritativeCandidate(enterprise);

  const vaultConsistent =
    !candidate
    || (
      (!enterprise.authoritativeAsset
        || enterprise.authoritativeAsset.vaultId === candidate.vaultId)
      && (!enterprise.match || enterprise.match.vaultId === candidate.vaultId)
      && (!enterprise.probableMatch || enterprise.probableMatch.vaultId === candidate.vaultId)
    );

  if (candidate && !vaultConsistent) {
    logger.error('[InvestigationDecision] Candidate vault mismatch — discarding for report', {
      candidateVault: candidate.vaultId?.slice(0, 8),
      matchVault: enterprise.match?.vaultId?.slice(0, 8),
      probableVault: enterprise.probableMatch?.vaultId?.slice(0, 8),
    });
    const decision = runAcceptanceEngine({
      analysisComplete: options?.analysisComplete !== false,
      failureReason: 'Retrieval candidate inconsistent across pipeline stages',
      hasCandidate: false,
      dna: { state: 'FAIL', score: 0 },
      certificate: { state: 'FAIL', score: 0 },
      vault: { state: 'FAIL', score: 0 },
      owner: { state: 'FAIL', score: 0 },
      timeline: { state: 'FAIL', score: 0 },
      visual: { state: 'FAIL', score: 0 },
      watermark: { state: 'FAIL', score: 0 },
      metadata: { state: 'SKIPPED', score: 0 },
      tamperDetected: false,
    });
    return outcomeFromAcceptance(decision, null);
  }

  const evidence = buildAcceptanceEvidenceFromEnterprise(enterprise, {
    analysisComplete: options?.analysisComplete,
    failureReason: options?.failureReason,
  });
  const decision = runAcceptanceEngine(evidence);
  return outcomeFromAcceptance(decision, candidate);
}

export function logInvestigationDecision(
  stage: string,
  outcome: InvestigationOutcome,
  extra?: Record<string, unknown>,
): void {
  logger.info(`[InvestigationDecision:${stage}]`, {
    state: outcome.state,
    acceptanceVerdict: outcome.acceptanceVerdict,
    displayLabel: outcome.displayLabel,
    decisionReason: outcome.decisionReason,
    vaultId: outcome.candidate?.vaultId ?? null,
    dnaRecordId: outcome.candidate?.dnaRecordId ?? null,
    ownerUserId: outcome.candidate?.ownerUserId ?? null,
    similarityScore: outcome.candidate?.confidence ?? null,
    retrievalConfidence: outcome.retrievalConfidence,
    forensicVerdict: outcome.forensicVerdict,
    acceptanceConfidence: outcome.acceptanceConfidence,
    acceptancePolicyVersion: outcome.acceptancePolicyVersion,
    ...extra,
  });
}

export function forensicVerdictForSummary(outcome: InvestigationOutcome): ForensicVerdict {
  return outcome.forensicVerdict;
}

export function labelForOutcome(outcome: InvestigationOutcome): string {
  return outcome.displayLabel;
}

/** Minimum 15-layer DNA score for Possible Similarity retention (candidates only) */
export const MIN_DNA_FOR_POSSIBLE_REPORT = 55;

/**
 * Whether similarity is strong enough to surface Top Candidates (never ownership).
 */
export function shouldRetainRetrievalCandidateAsPossible(
  enterprise: EnterpriseRecoveryResult,
  match: VaultMatchResult,
  dnaScore: number,
  retrievalConfidence: number,
  options?: { isVideoProbe?: boolean },
): boolean {
  const anchoredVault = enterprise.authoritativeAsset?.vaultId
    ?? enterprise.verifiedCandidate?.vaultId
    ?? enterprise.probableMatch?.vaultId;
  if (!anchoredVault || anchoredVault !== match.vaultId) return false;

  const source = enterprise.authoritativeAsset?.selectionSource;
  const isVideo = options?.isVideoProbe === true
    || /partial video/i.test(match.method);

  if (isVideo) {
    if (source === 'identity_hit' || source === 'sha256_exact') return true;
    if (/partial video/i.test(match.method) && retrievalConfidence >= 55) return true;
  }

  // Require multi-signal strength — visual alone at ~58% is NOT enough
  const vector = enterprise.authoritativeAsset?.vector;
  const orb = vector?.scores.orb ?? 0;
  const visual = Math.max(
    orb,
    vector?.scores.perceptualBlend ?? 0,
    vector?.scores.composite ?? 0,
    match.visualSimilarity != null ? match.visualSimilarity * 100 : 0,
  );
  const fused = Math.max(dnaScore, visual, retrievalConfidence);
  if (fused < MIN_DNA_FOR_POSSIBLE_REPORT) return false;

  // Need DNA ≥55 OR (visual ≥75 AND dna ≥40) — not perceptual-only mid-band
  if (dnaScore >= MIN_DNA_FOR_POSSIBLE_REPORT) return true;
  if (visual >= 75 && dnaScore >= 40) return true;
  return false;
}

/**
 * Re-run Acceptance after weak DNA. NEVER force-retain owner.
 * At most Possible Similarity with candidate cleared for ownership.
 */
export function downgradeToPossibleAfterWeakDna(
  match: VaultMatchResult,
  _current: InvestigationOutcome,
  dnaScore: number,
  classification: string,
  options?: { visualScore?: number; enterprise?: EnterpriseRecoveryResult },
): InvestigationOutcome {
  const vector = options?.enterprise?.authoritativeAsset?.vector;
  const visualScore = Math.max(
    options?.visualScore ?? 0,
    vector?.scores.orb ?? 0,
    vector?.scores.perceptualBlend ?? 0,
    vector?.scores.composite ?? 0,
    match.visualSimilarity != null ? match.visualSimilarity * 100 : 0,
    options?.enterprise?.fusion?.retrievalConfidence ?? 0,
  );

  const decision = runAcceptanceEngine({
    analysisComplete: true,
    hasCandidate: true,
    vaultId: match.vaultId,
    dnaRecordId: match.dnaRecordId,
    ownerUserId: match.ownerUserId,
    dna: {
      state: dnaScore >= MIN_DNA_FOR_POSSIBLE_REPORT ? 'PASS' : 'FAIL',
      score: dnaScore,
      classification,
    },
    certificate: { state: 'SKIPPED', score: 0, detail: 'Re-evaluated after DNA' },
    vault: { state: 'PASS', score: 100 },
    owner: { state: 'FAIL', score: 0, detail: 'Ownership not cryptographically bound' },
    timeline: { state: 'PASS', score: 50 },
    visual: { state: visualScore > 0 ? 'PASS' : 'FAIL', score: visualScore },
    watermark: { state: 'SKIPPED', score: 0 },
    metadata: { state: 'SKIPPED', score: 0 },
    tamperDetected: true,
  });

  // Never invent POSSIBLE with retained owner — respect Acceptance retainCandidate
  return outcomeFromAcceptance(decision, match);
}

/**
 * Re-run acceptance after authoritative DNA finishes.
 */
export function reAcceptWithDnaCompare(
  enterprise: EnterpriseRecoveryResult,
  match: VaultMatchResult,
  comparison: Pick<DnaComparisonResult, 'overallConfidenceScore' | 'classification' | 'layerComparisons'>,
): InvestigationOutcome {
  const dnaScore = comparison.overallConfidenceScore;
  const classification = comparison.classification ?? 'SIMILAR';
  const vector = enterprise.authoritativeAsset?.vector;
  const visual = Math.max(
    vector?.scores.orb ?? 0,
    vector?.scores.perceptualBlend ?? vector?.scores.pHash ?? 0,
    vector?.scores.composite ?? 0,
    match.visualSimilarity != null ? match.visualSimilarity * 100 : 0,
    enterprise.fusion?.retrievalConfidence ?? 0,
  );

  const base = buildAcceptanceEvidenceFromEnterprise(enterprise, { analysisComplete: true });
  const decision = runAcceptanceEngine({
    ...base,
    hasCandidate: true,
    vaultId: match.vaultId,
    dnaRecordId: match.dnaRecordId,
    ownerUserId: match.ownerUserId,
    dna: {
      state: dnaScore >= 40 ? 'PASS' : 'FAIL',
      score: dnaScore,
      classification,
    },
    visual: {
      state: visual > 0 ? 'PASS' : 'FAIL',
      score: Math.max(base.visual.score, visual),
      detail: base.visual.detail,
    },
    // Never invent owner PASS from retrieval
    owner: base.owner.state === 'PASS' && base.owner.score >= 80
      ? base.owner
      : { state: 'FAIL', score: 0, detail: 'Ownership not cryptographically bound' },
    tamperDetected: base.tamperDetected || dnaScore < 95,
    analysisComplete: true,
  });

  logInvestigationScores({
    stage: 'post_dna_accept',
    vaultId: match.vaultId,
    dnaRecordId: match.dnaRecordId,
    fingerprint: {
      overall: dnaScore,
      classification,
      layers: (comparison.layerComparisons ?? []).slice(0, 6).map((l) => ({
        layer: l.layer,
        percent: l.similarityPercent,
        matched: l.matched,
      })),
    },
    visual: {
      orb: vector?.scores.orb,
      perceptual: vector?.scores.perceptualBlend,
      composite: vector?.scores.composite,
      clip: vector?.scores.clip,
    },
    fusion: {
      retrieval: enterprise.fusion?.retrievalConfidence,
      identity: enterprise.fusion?.identityConfidence,
      ownershipVerification: enterprise.fusion?.ownershipVerificationConfidence,
      forensicVerdict: enterprise.fusion?.forensicVerdict,
    },
    acceptance: {
      verdict: decision.verdict,
      confidence: decision.confidence,
      dna: dnaScore,
      visual: Math.max(base.visual.score, visual),
      reason: decision.decisionReason,
    },
  });

  // No forced Possible with owner — let Acceptance decide
  return outcomeFromAcceptance(decision, match);
}

/** Build outcome for incomplete analysis (timeout, corrupt, missing tools). */
export function insufficientEvidenceOutcome(failureReason: string): InvestigationOutcome {
  const safeReason = sanitizeInvestigationError(failureReason);
  const decision = runAcceptanceEngine({
    analysisComplete: false,
    failureReason: safeReason,
    hasCandidate: false,
    dna: { state: 'SKIPPED', score: 0 },
    certificate: { state: 'SKIPPED', score: 0 },
    vault: { state: 'SKIPPED', score: 0 },
    owner: { state: 'SKIPPED', score: 0 },
    timeline: { state: 'SKIPPED', score: 0 },
    visual: { state: 'SKIPPED', score: 0 },
    watermark: { state: 'SKIPPED', score: 0 },
    metadata: { state: 'SKIPPED', score: 0 },
    tamperDetected: false,
  });
  return outcomeFromAcceptance(decision, null);
}

/** Build NOT_PINIT outcome after candidate rejection (retrieval confidence = 0). */
export function notPinitOutcome(reason: string): InvestigationOutcome {
  const decision = runAcceptanceEngine({
    analysisComplete: true,
    failureReason: reason,
    hasCandidate: false,
    dna: { state: 'FAIL', score: 0, detail: reason },
    certificate: { state: 'FAIL', score: 0 },
    vault: { state: 'FAIL', score: 0 },
    owner: { state: 'FAIL', score: 0 },
    timeline: { state: 'FAIL', score: 0 },
    visual: { state: 'FAIL', score: 0 },
    watermark: { state: 'FAIL', score: 0 },
    metadata: { state: 'SKIPPED', score: 0 },
    tamperDetected: false,
  });
  return outcomeFromAcceptance(decision, null);
}

/** @deprecated — labels live in ACCEPTANCE_VERDICT_LABELS; kept for import stability */
export { ACCEPTANCE_VERDICT_LABELS };
