/**
 * End-to-End Validation Runner.
 *
 * Executes an injected investigation function, builds a validation report,
 * compares actual vs expected verdicts, and returns PASS / FAIL.
 *
 * Does not enable ENTERPRISE_PIPELINE_V2. Does not alter pipeline internals.
 * Callers supply buffers / investigation adapters when assets exist.
 */

import type { EnterpriseInvestigationReport } from '../types/enterprise-investigation-pipeline.types';
import type { EnterpriseAcceptanceVerdict } from '../types/enterprise-acceptance.types';
import { buildEnterpriseValidationReport } from './validation-report.builder';
import { verifyPipelineStagesExecuteOnce } from './stage-once.verifier';
import type {
  GoldDatasetSample,
  ValidationCaseResult,
  ValidationSuiteResult,
} from './types';

export interface InvestigationProbeInput {
  sample: GoldDatasetSample;
  buffer: Buffer;
  ownerUserId: string;
}

export interface InvestigationProbeOutput {
  investigationReport: EnterpriseInvestigationReport;
}

export type InvestigationExecutor = (
  input: InvestigationProbeInput,
) => Promise<InvestigationProbeOutput>;

export interface RunValidationCaseOptions {
  sample: GoldDatasetSample;
  buffer: Buffer | null;
  ownerUserId: string;
  execute: InvestigationExecutor;
  /** When true, FAIL if stage-once audit fails even if verdict matches. */
  requireStageOnce?: boolean;
}

export function compareVerdict(
  actual: EnterpriseAcceptanceVerdict | null,
  expected: EnterpriseAcceptanceVerdict[],
): { pass: boolean; reason: string } {
  if (!expected.length) {
    return { pass: false, reason: 'no expected verdicts configured' };
  }
  if (actual == null) {
    return { pass: false, reason: 'actual verdict is null' };
  }
  if (expected.includes(actual)) {
    return { pass: true, reason: `verdict ${actual} in expected [${expected.join(', ')}]` };
  }
  return {
    pass: false,
    reason: `verdict ${actual} not in expected [${expected.join(', ')}]`,
  };
}

/**
 * Run one gold-dataset case. If buffer is null, result is SKIP (assets not populated yet).
 */
export async function runValidationCase(
  options: RunValidationCaseOptions,
): Promise<ValidationCaseResult> {
  const { sample, buffer, ownerUserId, execute, requireStageOnce = true } = options;

  if (!buffer || buffer.length === 0) {
    return {
      sampleId: sample.sampleId,
      expectedVerdicts: sample.expectedVerdicts,
      actualVerdict: null,
      result: 'SKIP',
      reason: 'no buffer — gold asset not populated',
      report: null,
      investigationId: null,
    };
  }

  const { investigationReport } = await execute({ sample, buffer, ownerUserId });
  const report = buildEnterpriseValidationReport({
    investigationReport,
    assetId: sample.sampleId,
  });

  const stageAudit = verifyPipelineStagesExecuteOnce(investigationReport);
  const verdictCheck = compareVerdict(report.finalVerdict, sample.expectedVerdicts);

  if (requireStageOnce && !stageAudit.ok) {
    return {
      sampleId: sample.sampleId,
      expectedVerdicts: sample.expectedVerdicts,
      actualVerdict: report.finalVerdict,
      result: 'FAIL',
      reason: `stage-once violation: ${stageAudit.violations.join('; ')}`,
      report,
      investigationId: report.investigationId,
    };
  }

  return {
    sampleId: sample.sampleId,
    expectedVerdicts: sample.expectedVerdicts,
    actualVerdict: report.finalVerdict,
    result: verdictCheck.pass ? 'PASS' : 'FAIL',
    reason: verdictCheck.reason,
    report,
    investigationId: report.investigationId,
  };
}

export interface RunValidationSuiteOptions {
  suiteId: string;
  samples: GoldDatasetSample[];
  /** Resolve buffer for a sample; return null to SKIP. */
  loadBuffer: (sample: GoldDatasetSample) => Promise<Buffer | null> | Buffer | null;
  ownerUserId: string;
  execute: InvestigationExecutor;
  requireStageOnce?: boolean;
}

export async function runValidationSuite(
  options: RunValidationSuiteOptions,
): Promise<ValidationSuiteResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const cases: ValidationCaseResult[] = [];

  for (const sample of options.samples) {
    const buffer = await options.loadBuffer(sample);
    cases.push(await runValidationCase({
      sample,
      buffer,
      ownerUserId: options.ownerUserId,
      execute: options.execute,
      requireStageOnce: options.requireStageOnce,
    }));
  }

  const finishedAt = new Date().toISOString();
  return {
    schema: 'enterprise-validation-suite-result-v1',
    suiteId: options.suiteId,
    startedAt,
    finishedAt,
    totalMs: Date.now() - t0,
    passed: cases.filter((c) => c.result === 'PASS').length,
    failed: cases.filter((c) => c.result === 'FAIL').length,
    skipped: cases.filter((c) => c.result === 'SKIP').length,
    cases,
  };
}
