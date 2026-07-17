/**
 * Enterprise Acceptance contracts (Milestone F / EDS P6–P9, P14).
 *
 * Consumes EnterpriseComparisonReport only — never recomputes comparison.
 */

import type { EnterpriseComparisonReport } from './enterprise-comparison.types';

/** Milestone F enterprise verdict set (explainable legal outcomes). */
export type EnterpriseAcceptanceVerdict =
  | 'VERIFIED_OWNER'
  | 'VERIFIED_COPY'
  | 'DERIVATIVE'
  | 'POSSIBLE_MATCH'
  | 'INSUFFICIENT_EVIDENCE'
  | 'NO_MATCH'
  | 'INVALID_PACKAGE'
  | 'PACKAGE_CORRUPTED';

export interface EnterpriseAcceptanceExplanation {
  decision: EnterpriseAcceptanceVerdict;
  reason: string;
  satisfiedConditions: string[];
  unsatisfiedConditions: string[];
  triggeredLayers: number[];
  supportingEvidence: string[];
  missingEvidence: string[];
}

/** Independent domain snapshot — never fused into one ownership %. */
export interface EnterpriseAcceptanceDomainEvaluation {
  identityScore: number;
  evidenceScore: number;
  ownershipScore: number;
  trustScore: number;
}

export interface EnterpriseAcceptanceDecision {
  schema: 'enterprise-acceptance-decision-v1';
  verdict: EnterpriseAcceptanceVerdict;
  policyVersion: string;
  domains: EnterpriseAcceptanceDomainEvaluation;
  explanation: EnterpriseAcceptanceExplanation;
  /** Owner/certificate visibility — true only for verified ownership tiers */
  retainCandidate: boolean;
  ruleId: string;
  executionTimeMs: number;
  comparedAt: string;
}

export interface EnterpriseAcceptanceInput {
  report: EnterpriseComparisonReport;
  /** Package missing entirely (legacy row / failed load) */
  packageMissing?: boolean;
  /** Integrity hash failed when package present */
  packageCorrupted?: boolean;
  /** Investigation analysis incomplete (timeouts, tool failure) */
  analysisComplete?: boolean;
  /** External ownership factors already verified upstream (cert / watermark extract) */
  ownershipHints?: {
    certificateBound?: boolean;
    watermarkBound?: boolean;
  };
}
