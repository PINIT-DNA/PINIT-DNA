/**
 * Investigation decision resolver — single authoritative candidate for reports.
 * No fallback substitution from unrelated vault records.
 */
import { logger } from '../../lib/logger';
import type { EnterpriseRecoveryResult } from './enterprise-recovery-pipeline.service';
import type { VaultMatchResult } from './vault-auto-match.service';
import type { ForensicVerdict } from './confidence-fusion-engine.service';

/** Three report states exposed to investigators */
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
}

/**
 * Authoritative candidate — ONLY from enterprise retrieval decision outputs.
 * Never candidates[0], leak-verify, or deep-compare fallbacks.
 */
export function resolveAuthoritativeCandidate(
  enterprise: EnterpriseRecoveryResult,
): VaultMatchResult | null {
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

export function deriveInvestigationOutcome(
  enterprise: EnterpriseRecoveryResult,
): InvestigationOutcome {
  const candidate = resolveAuthoritativeCandidate(enterprise);
  const retrievalConfidence = enterprise.fusion.retrievalConfidence ?? 0;

  if (!candidate) {
    const reason = enterprise.reportStateReason
      ?? `No retrieval candidate — fusion verdict ${enterprise.fusion.forensicVerdict}, retrieval ${retrievalConfidence}%`;
    return {
      state: 'NO_SIGNATURE',
      candidate: null,
      retrievalConfidence,
      forensicVerdict: 'NO_SIGNATURE',
      displayLabel: REPORT_STATE_LABELS.NO_SIGNATURE,
      decisionReason: reason,
    };
  }

  const vaultConsistent =
    (!enterprise.match || enterprise.match.vaultId === candidate.vaultId)
    && (!enterprise.probableMatch || enterprise.probableMatch.vaultId === candidate.vaultId);

  if (!vaultConsistent) {
    logger.error('[InvestigationDecision] Candidate vault mismatch — discarding for report', {
      candidateVault: candidate.vaultId?.slice(0, 8),
      matchVault: enterprise.match?.vaultId?.slice(0, 8),
      probableVault: enterprise.probableMatch?.vaultId?.slice(0, 8),
    });
    return {
      state: 'NO_SIGNATURE',
      candidate: null,
      retrievalConfidence,
      forensicVerdict: 'NO_SIGNATURE',
      displayLabel: REPORT_STATE_LABELS.NO_SIGNATURE,
      decisionReason: 'Retrieval candidate inconsistent across pipeline stages',
    };
  }

  const reportState = enterprise.reportState
    ?? (enterprise.identified || retrievalConfidence >= 75 ? 'VERIFIED' : 'POSSIBLE');

  if (reportState === 'VERIFIED') {
    const forensicVerdict: ForensicVerdict = retrievalConfidence >= 90
      ? 'ORIGINAL_VERIFIED'
      : 'ORIGINAL_FOUND_PARTIAL';
    return {
      state: 'VERIFIED',
      candidate,
      retrievalConfidence,
      forensicVerdict,
      displayLabel: REPORT_STATE_LABELS.VERIFIED,
      decisionReason: enterprise.reportStateReason
        ?? `Verified original asset — retrieval ${retrievalConfidence}%, vault ${candidate.vaultId.slice(0, 8)}…`,
    };
  }

  return {
    state: 'POSSIBLE',
    candidate,
    retrievalConfidence,
    forensicVerdict: 'POSSIBLE_ASSET',
    displayLabel: REPORT_STATE_LABELS.POSSIBLE,
    decisionReason: enterprise.reportStateReason
      ?? `Possible PINIT asset — retrieval ${retrievalConfidence}%, vault ${candidate.vaultId.slice(0, 8)}…`,
  };
}

export function logInvestigationDecision(
  stage: string,
  outcome: InvestigationOutcome,
  extra?: Record<string, unknown>,
): void {
  logger.info(`[InvestigationDecision:${stage}]`, {
    state: outcome.state,
    displayLabel: outcome.displayLabel,
    decisionReason: outcome.decisionReason,
    vaultId: outcome.candidate?.vaultId ?? null,
    dnaRecordId: outcome.candidate?.dnaRecordId ?? null,
    ownerUserId: outcome.candidate?.ownerUserId ?? null,
    similarityScore: outcome.candidate?.confidence ?? null,
    retrievalConfidence: outcome.retrievalConfidence,
    forensicVerdict: outcome.forensicVerdict,
    ...extra,
  });
}

export function forensicVerdictForSummary(outcome: InvestigationOutcome): ForensicVerdict {
  if (outcome.state === 'NO_SIGNATURE') return 'NO_SIGNATURE';
  if (outcome.state === 'VERIFIED') {
    return outcome.retrievalConfidence >= 90 ? 'ORIGINAL_VERIFIED' : 'ORIGINAL_FOUND_PARTIAL';
  }
  return 'POSSIBLE_ASSET';
}

export function labelForOutcome(outcome: InvestigationOutcome): string {
  return outcome.displayLabel;
}

/** Minimum 15-layer DNA score to show vault in report when retrieval anchored this vault */
export const MIN_DNA_FOR_POSSIBLE_REPORT = 20;

/**
 * When retrieval found a vault candidate but 15-layer DNA is weak (edited/cropped capture),
 * retain as Possible instead of NO_SIGNATURE.
 */
export function shouldRetainRetrievalCandidateAsPossible(
  enterprise: EnterpriseRecoveryResult,
  match: VaultMatchResult,
  dnaScore: number,
  retrievalConfidence: number,
): boolean {
  const anchoredVault = enterprise.verifiedCandidate?.vaultId ?? enterprise.probableMatch?.vaultId;
  if (!anchoredVault || anchoredVault !== match.vaultId) return false;
  if (dnaScore >= MIN_DNA_FOR_POSSIBLE_REPORT) return true;
  return retrievalConfidence >= 20 && dnaScore >= 10;
}

export function downgradeToPossibleAfterWeakDna(
  match: VaultMatchResult,
  current: InvestigationOutcome,
  dnaScore: number,
  classification: string,
): InvestigationOutcome {
  return {
    state: 'POSSIBLE',
    candidate: match,
    retrievalConfidence: current.retrievalConfidence,
    forensicVerdict: 'POSSIBLE_ASSET',
    displayLabel: REPORT_STATE_LABELS.POSSIBLE,
    decisionReason: `Possible PINIT asset — vault ${match.vaultId.slice(0, 8)}… · DNA ${dnaScore}% (${classification}) · retrieval ${current.retrievalConfidence}%`,
  };
}
