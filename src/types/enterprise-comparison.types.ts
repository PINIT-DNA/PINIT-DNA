/**
 * Enterprise 15-Layer Comparison contracts (Milestone E / EDS Part 3.1).
 *
 * Domain scores remain independent — never fused into one ownership/verdict %.
 * Acceptance Engine is explicitly out of scope.
 */

export type EnterpriseLayerCompareStatus =
  | 'MATCH'
  | 'PARTIAL'
  | 'MISMATCH'
  | 'NOT_PRESENT'
  | 'ERROR';

export type EnterpriseCompareMode = 'EXACT' | 'SIMILARITY' | 'EVIDENCE' | 'OWNERSHIP';

export type EnterpriseScoreDomain =
  | 'identity'
  | 'evidence'
  | 'ownership'
  | 'trust';

/** Unified per-layer comparator contract (EDS: every module implements compare()). */
export interface EnterpriseLayerCompareResult {
  layerId: number;
  layerName: string;
  domain: EnterpriseScoreDomain;
  mode: EnterpriseCompareMode;
  /** 0–100 retrieval/compare score for this layer only */
  score: number;
  /** 0–100 confidence in the score measurement */
  confidence: number;
  status: EnterpriseLayerCompareStatus;
  reason: string;
  evidence: string;
  executionTimeMs: number;
  algorithmId?: string;
  fingerprintVersion?: string;
}

/** Independent domain scores — MUST NOT be merged into one percentage. */
export interface EnterpriseDomainScores {
  identityScore: number;
  evidenceScore: number;
  ownershipScore: number;
  trustScore: number;
}

export interface EnterpriseVersionValidation {
  ok: boolean;
  reasons: string[];
  storedSchemaVersion?: string;
  probeSchemaVersion?: string;
  storedAlgorithmVersion?: string;
  probeAlgorithmVersion?: string;
  storedFingerprintVersion?: string;
  probeFingerprintVersion?: string;
}

export interface EnterpriseComparisonReport {
  schema: 'enterprise-comparison-report-v1';
  comparisonId: string;
  engineVersion: string;
  comparedAt: string;
  processingMs: number;
  versionValidation: EnterpriseVersionValidation;
  layers: EnterpriseLayerCompareResult[];
  domains: EnterpriseDomainScores;
  /** Informative only — not Acceptance verdict */
  summary: string;
}

/** Compare-ready layer view (stored package or ephemeral probe package). */
export interface EnterpriseCompareLayerInput {
  layerNumber: number;
  layerName: string;
  fingerprint: string;
  fingerprintAlgorithm?: string;
  fingerprintVersion?: string;
  present: boolean;
}

export interface EnterpriseComparePackageInput {
  dnaId: string;
  mediaType: string;
  contentId?: string;
  dnaSchemaVersion?: string;
  dnaAlgorithmVersion?: string;
  fingerprintVersion?: string;
  generatorVersion?: string;
  comparisonVersion?: string;
  layers: EnterpriseCompareLayerInput[];
}
