/**
 * Investigation decision resolver — maps Acceptance Engine output to report fields.
 * Final verdict authority: acceptance-engine.service.ts only.
 */
import { logger } from '../../lib/logger';
import type { EnterpriseRecoveryResult } from './enterprise-recovery-pipeline.service';
import type { VaultMatchResult } from './vault-auto-match.service';
import type { ForensicVerdict } from './confidence-fusion-engine.service';
import type { AcceptanceDecision, AcceptanceVerdict } from '../../types/acceptance.types';
import { runAcceptanceEngine } from './acceptance-engine.service';
import { buildAcceptanceEvidenceFromEnterprise } from './acceptance-evidence.builder';

/** Legacy three-state UI mapping (UI unchanged). */
export type InvestigationReportState = 'VERIFIED' | 'POSSIBLE' | 'NO_SIGNATURE';

export const REPORT_STATE_LABELS: Record<InvestigationReportState, string> = {
  VERIFIED: 'Verified Original PINIT Asset',
  POSSIBLE: 'Possible PINIT Asset',
  NO_SIGNATURE: 'No PINIT Signature Found',
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
}

/**
 * Authoritative candidate — ONLY from enterprise authoritativeAsset.
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

/** Minimum 15-layer DNA score to show vault in report when retrieval anchored this vault */
export const MIN_DNA_FOR_POSSIBLE_REPORT = 40;

/**
 * When retrieval found a vault candidate but 15-layer DNA is weak (edited/cropped capture),
 * retain as Possible instead of NO_SIGNATURE.
 *
 * Images: NEVER retain when DNA is DIFFERENT or below threshold.
 * Video: identity_hit / sha256 / partial-video anchors may retain.
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
    if (/partial video/i.test(match.method) && retrievalConfidence >= 28) return true;
  }

  if (dnaScore < MIN_DNA_FOR_POSSIBLE_REPORT) return false;
  return dnaScore >= MIN_DNA_FOR_POSSIBLE_REPORT;
}

/**
 * Re-run Acceptance Engine after DNA compare updates evidence.
 * Does not invent verdicts outside the engine.
 */
export function downgradeToPossibleAfterWeakDna(
  match: VaultMatchResult,
  _current: InvestigationOutcome,
  dnaScore: number,
  classification: string,
): InvestigationOutcome {
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
    certificate: { state: 'FAIL', score: 0, detail: 'Re-evaluated after DNA' },
    vault: { state: 'PASS', score: 100 },
    owner: { state: 'PASS', score: 50 },
    timeline: { state: 'PASS', score: 50 },
    visual: { state: 'PASS', score: 50 },
    watermark: { state: 'FAIL', score: 0 },
    metadata: { state: 'SKIPPED', score: 0 },
    tamperDetected: true,
  });

  return {
    state: mapAcceptanceToReportState(decision.verdict),
    candidate: decision.retainCandidate ? match : null,
    retrievalConfidence: decision.retrievalConfidence,
    forensicVerdict: mapAcceptanceToForensicVerdict(decision.verdict),
    displayLabel: decision.displayLabel,
    decisionReason: decision.decisionReason,
    acceptanceVerdict: decision.verdict,
    acceptancePolicyVersion: decision.acceptancePolicyVersion,
    dnaAlgorithmVersion: decision.dnaAlgorithmVersion,
    acceptanceConfidence: decision.confidence,
  };
}

/** Build outcome for incomplete analysis (timeout, corrupt, missing tools). */
export function insufficientEvidenceOutcome(failureReason: string): InvestigationOutcome {
  const decision = runAcceptanceEngine({
    analysisComplete: false,
    failureReason,
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
