/**
 * Builds EnterpriseValidationReport from an EnterpriseInvestigationReport.
 * Projection only — no re-scoring, no pipeline calls.
 */

import type { EnterpriseInvestigationReport } from '../types/enterprise-investigation-pipeline.types';
import type { EnterpriseValidationReport, ValidationLayerResult } from './types';

export interface BuildValidationReportInput {
  investigationReport: EnterpriseInvestigationReport;
  /** Caller-supplied asset id (vault / sample / probe id). */
  assetId: string;
}

export function buildEnterpriseValidationReport(
  input: BuildValidationReportInput,
): EnterpriseValidationReport {
  const r = input.investigationReport;
  const decision = r.acceptanceDecision;
  const best = r.candidateOutcomes.find((o) => o.acceptance === decision)
    ?? r.candidateOutcomes[0]
    ?? null;

  const layerResults: ValidationLayerResult[] = (r.layerReport ?? []).map((l) => ({
    layerId: l.layerId,
    layerName: l.layerName,
    status: l.status,
    score: l.score,
    domain: l.domain,
  }));

  return {
    schema: 'enterprise-validation-report-v1',
    investigationId: r.investigationId,
    assetId: input.assetId,
    probeFilename: r.probeFilename,
    candidateCount: r.candidates.length,
    selectedCandidate: {
      vaultId: best?.vaultId ?? null,
      dnaRecordId: best?.dnaRecordId ?? null,
    },
    retrievalSummary: { ...r.retrievalSummary },
    comparisonSummary: { ...r.comparisonSummary },
    acceptanceSummary: {
      verdict: decision?.verdict ?? null,
      ruleId: decision?.ruleId ?? null,
      reason: decision?.explanation.reason ?? null,
      retainCandidate: decision?.retainCandidate ?? false,
    },
    layerResults,
    domains: {
      identity: decision?.domains.identityScore ?? r.comparisonSummary.bestIdentityScore,
      evidence: decision?.domains.evidenceScore ?? r.comparisonSummary.bestEvidenceScore,
      ownership: decision?.domains.ownershipScore ?? r.comparisonSummary.bestOwnershipScore,
      trust: decision?.domains.trustScore ?? r.comparisonSummary.bestTrustScore,
    },
    finalVerdict: decision?.verdict ?? null,
    executionTimeMs: r.totalExecutionMs,
    stages: [...r.stages],
    createdAt: new Date().toISOString(),
  };
}
