/**
 * Validation Readiness — typed contracts for evidence collection.
 * Does not alter DNA generation, retrieval, comparison, acceptance, or pipeline logic.
 */

import type { EnterpriseAcceptanceVerdict } from '../types/enterprise-acceptance.types';
import type { EnterpriseLayerCompareResult } from '../types/enterprise-comparison.types';
import type { EnterprisePipelineStageResult } from '../types/enterprise-investigation-pipeline.types';

/** Final outcome of a single validation case. */
export type ValidationPassFail = 'PASS' | 'FAIL' | 'SKIP';

/** Domain score snapshot copied from enterprise comparison / acceptance. */
export interface ValidationDomainScores {
  identity: number;
  evidence: number;
  ownership: number;
  trust: number;
}

/** Layer row for validation evidence (read-only projection). */
export interface ValidationLayerResult {
  layerId: number;
  layerName: string;
  status: EnterpriseLayerCompareResult['status'];
  score: number;
  domain: EnterpriseLayerCompareResult['domain'];
}

/**
 * Validation Report — evidence artifact for end-to-end investigation checks.
 * Schema is additive; maps from EnterpriseInvestigationReport without re-scoring.
 */
export interface EnterpriseValidationReport {
  schema: 'enterprise-validation-report-v1';
  investigationId: string;
  assetId: string;
  probeFilename: string;
  candidateCount: number;
  selectedCandidate: {
    vaultId: string | null;
    dnaRecordId: string | null;
  };
  retrievalSummary: {
    providerCount: number;
    mergedCandidateCount: number;
    finalCandidateCount: number;
    topVaultIds: string[];
  };
  comparisonSummary: {
    candidatesCompared: number;
    bestIdentityScore: number;
    bestOwnershipScore: number;
    bestEvidenceScore: number;
    bestTrustScore: number;
  };
  acceptanceSummary: {
    verdict: EnterpriseAcceptanceVerdict | null;
    ruleId: string | null;
    reason: string | null;
    retainCandidate: boolean;
  };
  layerResults: ValidationLayerResult[];
  domains: ValidationDomainScores;
  finalVerdict: EnterpriseAcceptanceVerdict | null;
  executionTimeMs: number;
  stages: EnterprisePipelineStageResult[];
  createdAt: string;
}

/** Expected relationship of a gold-dataset sample to its original. */
export type GoldDatasetRelationship =
  | 'ORIGINAL'
  | 'JPEG_RECOMPRESSION'
  | 'PNG_CONVERSION'
  | 'RESIZE'
  | 'CROP'
  | 'SCREENSHOT'
  | 'METADATA_REMOVED'
  | 'BRIGHTNESS_ADJUSTMENT'
  | 'CONTRAST_ADJUSTMENT'
  | 'WATERMARK_ADDED'
  | 'WATERMARK_REMOVED'
  | 'PDF_EXPORT'
  | 'VIDEO_TRANSCODE'
  | 'AUDIO_RECOMPRESSION'
  | 'UNRELATED';

/** Allowed expected verdicts (may list alternatives). */
export type GoldExpectedVerdict = EnterpriseAcceptanceVerdict;

export interface GoldDatasetSample {
  /** Stable id within the manifest (not a filesystem path requirement). */
  sampleId: string;
  /** Relative path placeholder — file may not exist yet. */
  relativePath: string;
  relationship: GoldDatasetRelationship;
  /** Parent original sampleId; null for ORIGINAL / UNRELATED roots. */
  originalSampleId: string | null;
  mimeType: string;
  /** One or more acceptable verdicts for PASS. */
  expectedVerdicts: GoldExpectedVerdict[];
  notes?: string;
  /** Optional tags for filtering suites. */
  tags?: string[];
}

export interface GoldDatasetManifest {
  schema: 'enterprise-gold-dataset-manifest-v1';
  version: string;
  description: string;
  createdAt: string;
  /** Metadata only — no binary assets embedded. */
  samples: GoldDatasetSample[];
}

export interface ValidationCaseResult {
  sampleId: string;
  expectedVerdicts: GoldExpectedVerdict[];
  actualVerdict: EnterpriseAcceptanceVerdict | null;
  result: ValidationPassFail;
  reason: string;
  report: EnterpriseValidationReport | null;
  investigationId: string | null;
}

export interface ValidationSuiteResult {
  schema: 'enterprise-validation-suite-result-v1';
  suiteId: string;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  passed: number;
  failed: number;
  skipped: number;
  cases: ValidationCaseResult[];
}

/** Stage-once audit: each critical stage must appear exactly once. */
export interface StageOnceAudit {
  ok: boolean;
  investigationId: string;
  counts: {
    generationContext: number;
    retrieval: number;
    comparison: number;
    acceptance: number;
  };
  violations: string[];
}

/** Regression suite identifiers (scaffolding only). */
export type RegressionSuiteId =
  | 'deterministic_dna'
  | 'enterprise_package_integrity'
  | 'retrieval_recall'
  | 'comparison_consistency'
  | 'acceptance_consistency'
  | 'pipeline_consistency';

export interface RegressionSuiteSpec {
  id: RegressionSuiteId;
  title: string;
  description: string;
  /** Placeholder — suite not populated with assets yet. */
  status: 'SCAFFOLD';
}
