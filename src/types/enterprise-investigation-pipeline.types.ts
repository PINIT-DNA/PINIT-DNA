/**
 * Enterprise Investigation Pipeline contracts (Milestone G).
 *
 * Strongly typed stage I/O — no anonymous maps / magic objects.
 * Pipeline integrates completed modules only (no new algorithms).
 */

import type { EnterpriseComparisonReport } from './enterprise-comparison.types';
import type { EnterpriseAcceptanceDecision } from './enterprise-acceptance.types';
import type { RankedVaultCandidate } from './unified-investigation.types';

export type EnterprisePipelineStageStatus =
  | 'SUCCESS'
  | 'WARNING'
  | 'FAILED'
  | 'SKIPPED';

export type EnterprisePipelineStageName =
  | 'init'
  | 'generation_context'
  | 'storage_load'
  | 'retrieval'
  | 'comparison'
  | 'acceptance'
  | 'report';

export interface EnterprisePipelineStageResult {
  stage: EnterprisePipelineStageName;
  status: EnterprisePipelineStageStatus;
  detail: string;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
}

export interface EnterprisePipelineRetrievalSummary {
  providerCount: number;
  mergedCandidateCount: number;
  finalCandidateCount: number;
  topVaultIds: string[];
}

export interface EnterprisePipelineCandidateOutcome {
  vaultId: string;
  dnaRecordId: string;
  packageStatus: 'SEALED' | 'MISSING' | 'CORRUPTED' | 'LEGACY';
  comparison?: EnterpriseComparisonReport;
  acceptance?: EnterpriseAcceptanceDecision;
}

export interface EnterpriseInvestigationReport {
  schema: 'enterprise-investigation-report-v1';
  investigationId: string;
  ownerUserId: string;
  probeFilename: string;
  probeMimeType: string;
  packageValidation: {
    status: EnterprisePipelineStageStatus;
    detail: string;
    storedPackageUsed: boolean;
  };
  retrievalSummary: EnterprisePipelineRetrievalSummary;
  comparisonSummary: {
    candidatesCompared: number;
    bestIdentityScore: number;
    bestOwnershipScore: number;
    bestEvidenceScore: number;
    bestTrustScore: number;
  };
  acceptanceDecision: EnterpriseAcceptanceDecision | null;
  layerReport: EnterpriseComparisonReport['layers'] | null;
  evidence: {
    evidenceScore: number;
    evidenceLayers: number[];
  };
  ownership: {
    ownershipScore: number;
    retainCandidate: boolean;
    ownershipLayers: number[];
  };
  trust: {
    trustScore: number;
  };
  candidates: RankedVaultCandidate[];
  candidateOutcomes: EnterprisePipelineCandidateOutcome[];
  stages: EnterprisePipelineStageResult[];
  totalExecutionMs: number;
  createdAt: string;
  pipelineVersion: 'enterprise-pipeline-v2';
}

export interface EnterprisePipelineInput {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  ownerUserId: string;
  investigationId?: string;
  /** Max candidates to deep-compare after retrieval union */
  deepCompareLimit?: number;
}

/** Full pipeline run output — report is SSoT; identification adapts for legacy callers. */
export interface EnterprisePipelineRunResult {
  report: EnterpriseInvestigationReport;
  investigationId: string;
}
