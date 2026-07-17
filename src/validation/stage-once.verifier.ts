/**
 * Stage-once verifier — read-only audit of EnterpriseInvestigationReport stages.
 * Does not modify pipeline behaviour; only inspects produced evidence.
 */

import type { EnterpriseInvestigationReport } from '../types/enterprise-investigation-pipeline.types';
import type { StageOnceAudit } from './types';

const CRITICAL_STAGES = [
  'generation_context',
  'retrieval',
  'comparison',
  'acceptance',
] as const;

/**
 * Verify generation / retrieval / comparison / acceptance each appear exactly once.
 * Extra duplicate stage rows → violation. Missing stage → violation.
 */
export function verifyPipelineStagesExecuteOnce(
  report: EnterpriseInvestigationReport,
): StageOnceAudit {
  const violations: string[] = [];
  const counts = {
    generationContext: 0,
    retrieval: 0,
    comparison: 0,
    acceptance: 0,
  };

  for (const stage of report.stages) {
    if (stage.stage === 'generation_context') counts.generationContext += 1;
    if (stage.stage === 'retrieval') counts.retrieval += 1;
    if (stage.stage === 'comparison') counts.comparison += 1;
    if (stage.stage === 'acceptance') counts.acceptance += 1;
  }

  const expected: Array<{ key: keyof typeof counts; name: (typeof CRITICAL_STAGES)[number] }> = [
    { key: 'generationContext', name: 'generation_context' },
    { key: 'retrieval', name: 'retrieval' },
    { key: 'comparison', name: 'comparison' },
    { key: 'acceptance', name: 'acceptance' },
  ];

  for (const row of expected) {
    const n = counts[row.key];
    if (n === 0) {
      violations.push(`missing stage: ${row.name}`);
    } else if (n > 1) {
      violations.push(`duplicate stage: ${row.name} ran ${n} times`);
    }
  }

  return {
    ok: violations.length === 0,
    investigationId: report.investigationId,
    counts,
    violations,
  };
}
