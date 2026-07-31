/**
 * Regression test scaffolding registry.
 * Suites are declared for future population — no production behaviour changes.
 */

import type { RegressionSuiteSpec } from './types';

export const REGRESSION_SUITE_SPECS: readonly RegressionSuiteSpec[] = [
  {
    id: 'deterministic_dna',
    title: 'Deterministic DNA',
    description:
      'Same input bytes → identical fingerprints / package integrity hashes across runs.',
    status: 'SCAFFOLD',
  },
  {
    id: 'enterprise_package_integrity',
    title: 'Enterprise Package Integrity',
    description:
      'Sealed enterpriseDnaPackage validates; corruption / missing package is detected.',
    status: 'SCAFFOLD',
  },
  {
    id: 'retrieval_recall',
    title: 'Retrieval Recall',
    description:
      'Gold originals and known derivatives appear in the candidate union within top-K.',
    status: 'SCAFFOLD',
  },
  {
    id: 'comparison_consistency',
    title: 'Comparison Consistency',
    description:
      'Stored package vs probe yields stable domain scores for identical inputs.',
    status: 'SCAFFOLD',
  },
  {
    id: 'acceptance_consistency',
    title: 'Acceptance Consistency',
    description:
      'Same EnterpriseComparisonReport → same acceptance verdict and explanation.',
    status: 'SCAFFOLD',
  },
  {
    id: 'pipeline_consistency',
    title: 'Pipeline Consistency',
    description:
      'ENTERPRISE_PIPELINE_V2 stages execute once; report schema remains stable.',
    status: 'SCAFFOLD',
  },
] as const;

export function listRegressionSuiteSpecs(): readonly RegressionSuiteSpec[] {
  return REGRESSION_SUITE_SPECS;
}

export function getRegressionSuiteSpec(id: string): RegressionSuiteSpec | undefined {
  return REGRESSION_SUITE_SPECS.find((s) => s.id === id);
}
