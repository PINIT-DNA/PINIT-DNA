/**
 * Validation Readiness — framework unit tests (no production pipeline changes).
 */
import {
  verifyPipelineStagesExecuteOnce,
  buildEnterpriseValidationReport,
  createScaffoldGoldDatasetManifest,
  validateGoldDatasetManifest,
  GOLD_DATASET_RELATIONSHIPS,
  runValidationCase,
  runValidationSuite,
  compareVerdict,
  listRegressionSuiteSpecs,
  getRegressionSuiteSpec,
} from '../../src/validation';
import type { EnterpriseInvestigationReport } from '../../src/types/enterprise-investigation-pipeline.types';
import { isEnterpriseFeatureEnabled } from '../../src/config/enterprise-feature-flags';
import scaffoldManifest from '../../validation/gold-dataset/manifest.scaffold.json';

function stage(
  name: EnterpriseInvestigationReport['stages'][number]['stage'],
  status: EnterpriseInvestigationReport['stages'][number]['status'] = 'SUCCESS',
): EnterpriseInvestigationReport['stages'][number] {
  return {
    stage: name,
    status,
    detail: 'test',
    durationMs: 1,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

function makeReport(
  overrides?: Partial<EnterpriseInvestigationReport>,
): EnterpriseInvestigationReport {
  return {
    schema: 'enterprise-investigation-report-v1',
    investigationId: 'inv-val-001',
    ownerUserId: 'owner-1',
    probeFilename: 'probe.jpg',
    probeMimeType: 'image/jpeg',
    packageValidation: {
      status: 'SUCCESS',
      detail: 'ok',
      storedPackageUsed: true,
    },
    retrievalSummary: {
      providerCount: 2,
      mergedCandidateCount: 3,
      finalCandidateCount: 3,
      topVaultIds: ['vault-1'],
    },
    comparisonSummary: {
      candidatesCompared: 1,
      bestIdentityScore: 95,
      bestOwnershipScore: 90,
      bestEvidenceScore: 40,
      bestTrustScore: 80,
    },
    acceptanceDecision: {
      schema: 'enterprise-acceptance-decision-v1',
      verdict: 'VERIFIED_OWNER',
      policyVersion: 'test',
      domains: {
        identityScore: 95,
        evidenceScore: 40,
        ownershipScore: 90,
        trustScore: 80,
      },
      explanation: {
        decision: 'VERIFIED_OWNER',
        reason: 'test reason',
        satisfiedConditions: [],
        unsatisfiedConditions: [],
        triggeredLayers: [1, 14],
        supportingEvidence: [],
        missingEvidence: [],
      },
      retainCandidate: true,
      ruleId: 'TEST',
      executionTimeMs: 1,
      comparedAt: new Date().toISOString(),
    },
    layerReport: [
      {
        layerId: 1,
        layerName: 'L1',
        domain: 'identity',
        mode: 'EXACT',
        score: 100,
        confidence: 100,
        status: 'MATCH',
        reason: 'match',
        evidence: 'match',
        executionTimeMs: 1,
      },
    ],
    evidence: { evidenceScore: 40, evidenceLayers: [] },
    ownership: { ownershipScore: 90, retainCandidate: true, ownershipLayers: [14] },
    trust: { trustScore: 80 },
    candidates: [{
      rank: 1,
      dnaRecordId: 'dna-1',
      vaultId: 'vault-1',
      ownerUserId: 'owner-1',
      preliminaryScore: 90,
      compositeScore: 90,
      method: 'test',
      signals: [],
    }],
    candidateOutcomes: [{
      vaultId: 'vault-1',
      dnaRecordId: 'dna-1',
      packageStatus: 'SEALED',
    }],
    stages: [
      stage('init'),
      stage('generation_context'),
      stage('storage_load'),
      stage('retrieval'),
      stage('comparison'),
      stage('acceptance'),
      stage('report'),
    ],
    totalExecutionMs: 42,
    createdAt: new Date().toISOString(),
    pipelineVersion: 'enterprise-pipeline-v2',
    ...overrides,
  };
}

describe('validation readiness framework', () => {
  it('keeps ENTERPRISE_PIPELINE_V2 default OFF', () => {
    expect(isEnterpriseFeatureEnabled('ENTERPRISE_PIPELINE_V2')).toBe(false);
  });

  describe('stage-once verifier', () => {
    it('passes when critical stages appear once', () => {
      const audit = verifyPipelineStagesExecuteOnce(makeReport());
      expect(audit.ok).toBe(true);
      expect(audit.counts).toEqual({
        generationContext: 1,
        retrieval: 1,
        comparison: 1,
        acceptance: 1,
      });
      expect(audit.violations).toHaveLength(0);
    });

    it('fails on duplicate retrieval', () => {
      const report = makeReport({
        stages: [
          stage('init'),
          stage('generation_context'),
          stage('storage_load'),
          stage('retrieval'),
          stage('retrieval'),
          stage('comparison'),
          stage('acceptance'),
          stage('report'),
        ],
      });
      const audit = verifyPipelineStagesExecuteOnce(report);
      expect(audit.ok).toBe(false);
      expect(audit.violations.some((v) => v.includes('duplicate stage: retrieval'))).toBe(true);
    });

    it('fails when comparison is missing', () => {
      const report = makeReport({
        stages: [
          stage('init'),
          stage('generation_context'),
          stage('storage_load'),
          stage('retrieval'),
          stage('acceptance'),
          stage('report'),
        ],
      });
      const audit = verifyPipelineStagesExecuteOnce(report);
      expect(audit.ok).toBe(false);
      expect(audit.violations).toContain('missing stage: comparison');
    });
  });

  describe('validation report builder', () => {
    it('projects required evidence fields', () => {
      const v = buildEnterpriseValidationReport({
        investigationReport: makeReport(),
        assetId: 'asset-original-001',
      });
      expect(v.schema).toBe('enterprise-validation-report-v1');
      expect(v.investigationId).toBe('inv-val-001');
      expect(v.assetId).toBe('asset-original-001');
      expect(v.candidateCount).toBe(1);
      expect(v.selectedCandidate.vaultId).toBe('vault-1');
      expect(v.domains.identity).toBe(95);
      expect(v.domains.evidence).toBe(40);
      expect(v.domains.ownership).toBe(90);
      expect(v.domains.trust).toBe(80);
      expect(v.finalVerdict).toBe('VERIFIED_OWNER');
      expect(v.executionTimeMs).toBe(42);
      expect(v.layerResults).toHaveLength(1);
      expect(v.acceptanceSummary.ruleId).toBe('TEST');
    });
  });

  describe('gold dataset manifest', () => {
    it('covers all declared relationships in scaffold', () => {
      const manifest = createScaffoldGoldDatasetManifest();
      const check = validateGoldDatasetManifest(manifest);
      expect(check.ok).toBe(true);
      const relationships = new Set(manifest.samples.map((s) => s.relationship));
      for (const r of GOLD_DATASET_RELATIONSHIPS) {
        expect(relationships.has(r)).toBe(true);
      }
      expect(manifest.samples.every((s) => s.notes?.includes('not generated'))).toBe(true);
    });

    it('matches checked-in scaffold JSON schema id', () => {
      expect(scaffoldManifest.schema).toBe('enterprise-gold-dataset-manifest-v1');
      expect(validateGoldDatasetManifest(scaffoldManifest as never).ok).toBe(true);
    });
  });

  describe('e2e validation runner', () => {
    it('compareVerdict PASS/FAIL', () => {
      expect(compareVerdict('VERIFIED_OWNER', ['VERIFIED_OWNER']).pass).toBe(true);
      expect(compareVerdict('NO_MATCH', ['VERIFIED_OWNER']).pass).toBe(false);
      expect(compareVerdict(null, ['NO_MATCH']).pass).toBe(false);
    });

    it('SKIPs when buffer missing', async () => {
      const sample = createScaffoldGoldDatasetManifest().samples[0]!;
      const result = await runValidationCase({
        sample,
        buffer: null,
        ownerUserId: 'owner-1',
        execute: async () => ({ investigationReport: makeReport() }),
      });
      expect(result.result).toBe('SKIP');
    });

    it('PASS when verdict matches and stages once', async () => {
      const sample = createScaffoldGoldDatasetManifest().samples[0]!;
      const result = await runValidationCase({
        sample,
        buffer: Buffer.from('probe'),
        ownerUserId: 'owner-1',
        execute: async () => ({ investigationReport: makeReport() }),
      });
      expect(result.result).toBe('PASS');
      expect(result.report?.finalVerdict).toBe('VERIFIED_OWNER');
    });

    it('FAIL when verdict mismatches', async () => {
      const sample = createScaffoldGoldDatasetManifest().samples.find(
        (s) => s.relationship === 'UNRELATED',
      )!;
      const result = await runValidationCase({
        sample,
        buffer: Buffer.from('probe'),
        ownerUserId: 'owner-1',
        execute: async () => ({ investigationReport: makeReport() }),
      });
      expect(result.result).toBe('FAIL');
      expect(result.actualVerdict).toBe('VERIFIED_OWNER');
    });

    it('suite aggregates PASS/FAIL/SKIP', async () => {
      const samples = createScaffoldGoldDatasetManifest().samples.slice(0, 3);
      const suite = await runValidationSuite({
        suiteId: 'scaffold-smoke',
        samples,
        ownerUserId: 'owner-1',
        loadBuffer: (s) => (s.relationship === 'ORIGINAL' ? Buffer.from('x') : null),
        execute: async () => ({ investigationReport: makeReport() }),
      });
      expect(suite.passed).toBe(1);
      expect(suite.skipped).toBe(2);
      expect(suite.failed).toBe(0);
    });
  });

  describe('regression scaffolding', () => {
    it('lists six scaffold suites', () => {
      const specs = listRegressionSuiteSpecs();
      expect(specs).toHaveLength(6);
      expect(specs.every((s) => s.status === 'SCAFFOLD')).toBe(true);
      expect(getRegressionSuiteSpec('pipeline_consistency')?.title).toContain('Pipeline');
    });
  });
});
