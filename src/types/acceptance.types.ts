/**
 * Acceptance Engine types — docs/architecture/02_ACCEPTANCE_RULES.md
 * Modules produce evidence only; only the Acceptance Engine emits verdicts.
 *
 * WHY re-export from dna-versions (Task A1): keep public import paths stable
 * (`ACCEPTANCE_POLICY_VERSION`, `DNA_ALGORITHM_VERSION`) while centralizing
 * the literal values in src/config/dna-versions.ts — no behaviour change.
 */
import {
  DNA_ACCEPTANCE_VERSION,
  DNA_ALGORITHM_VERSION,
} from '../config/dna-versions';
import type { EnterpriseComparisonReport } from './enterprise-comparison.types';
import type { EnterpriseAcceptanceDecision } from './enterprise-acceptance.types';

export { DNA_ALGORITHM_VERSION };

/** Alias of DNA_ACCEPTANCE_VERSION — preserved for existing call sites. */
export const ACCEPTANCE_POLICY_VERSION = DNA_ACCEPTANCE_VERSION;

/** Frozen five verdicts — no additional codes. */
export type AcceptanceVerdict =
  | 'VERIFIED_ORIGINAL'
  | 'VERIFIED_DERIVATIVE'
  | 'POSSIBLE_MATCH'
  | 'NOT_PINIT'
  | 'INSUFFICIENT_EVIDENCE';

export type ChannelState = 'PASS' | 'FAIL' | 'SKIPPED';

/** Single evidence channel — never includes a verdict. */
export interface EvidenceChannel {
  state: ChannelState;
  /** 0–100; ignored for contribution when state is FAIL or SKIPPED */
  score: number;
  detail?: string;
}

export interface AcceptanceEvidence {
  /** False when analysis could not complete (timeout, corrupt, missing tools). */
  analysisComplete: boolean;
  failureReason?: string;
  /** True when a vault candidate is under consideration. */
  hasCandidate: boolean;
  vaultId?: string;
  dnaRecordId?: string;
  ownerUserId?: string;
  ownerPinitId?: string;

  dna: EvidenceChannel & { classification?: string };
  certificate: EvidenceChannel;
  vault: EvidenceChannel;
  owner: EvidenceChannel;
  timeline: EvidenceChannel;
  visual: EvidenceChannel;
  watermark: EvidenceChannel;
  metadata: EvidenceChannel;

  /** Tamper never creates identity — only modifies verdict tier. */
  tamperDetected: boolean;

  /**
   * Milestone F — when ACCEPTANCE_V2 is on and COMPARISON_V2 produced a report,
   * Acceptance evaluates this report instead of fused overallConfidenceScore.
   */
  enterpriseComparison?: EnterpriseComparisonReport;
  packageMissing?: boolean;
  packageCorrupted?: boolean;
  ownershipHints?: {
    certificateBound?: boolean;
    watermarkBound?: boolean;
  };
}

export interface ScorecardChannelResult {
  weight: number;
  score: number;
  contribution: number;
  state: ChannelState;
}

export interface AcceptanceScorecard {
  certificate: ScorecardChannelResult;
  dna: ScorecardChannelResult;
  visual: ScorecardChannelResult;
  metadata: ScorecardChannelResult;
  watermark: ScorecardChannelResult;
  timeline: ScorecardChannelResult;
  owner: ScorecardChannelResult;
  /** 0–100 explainable total */
  finalConfidence: number;
}

export interface AcceptanceDecision {
  verdict: AcceptanceVerdict;
  acceptancePolicyVersion: typeof ACCEPTANCE_POLICY_VERSION;
  dnaAlgorithmVersion: typeof DNA_ALGORITHM_VERSION;
  confidence: number;
  scorecard: AcceptanceScorecard;
  displayLabel: string;
  decisionReason: string;
  /** Candidate retained only when verdict is not NOT_PINIT / INSUFFICIENT_EVIDENCE */
  retainCandidate: boolean;
  /** Retrieval confidence exposed to report — 0 when rejected */
  retrievalConfidence: number;
  /** Milestone F — present when ACCEPTANCE_V2 produced the decision */
  enterpriseAcceptance?: EnterpriseAcceptanceDecision;
}
