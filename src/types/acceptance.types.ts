/**
 * Acceptance Engine types — docs/architecture/02_ACCEPTANCE_RULES.md
 * Modules produce evidence only; only the Acceptance Engine emits verdicts.
 */

export const ACCEPTANCE_POLICY_VERSION = 'acceptance-policy-v1.2' as const;
export const DNA_ALGORITHM_VERSION = '15-layer-v1' as const;

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
}
