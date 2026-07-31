/**
 * Milestone G — Enterprise Investigation Pipeline integration.
 * Uses injected deps (no DB / no new algorithms).
 */
import {
  EnterpriseInvestigationPipeline,
  selectBestCandidateOutcome,
  isEnterprisePipelineV2Enabled,
} from '../../src/services/forensics/enterprise-investigation-pipeline.service';
import type { EnterpriseInvestigationPipelineDeps } from '../../src/services/forensics/enterprise-investigation-pipeline.service';
import type { EnterpriseDnaPackage } from '../../src/types/enterprise-dna-package.types';
import type { EnterpriseComparisonReport } from '../../src/types/enterprise-comparison.types';
import type { EnterpriseAcceptanceDecision } from '../../src/types/enterprise-acceptance.types';
import type { EphemeralFingerprint } from '../../src/services/verification/ephemeral-fingerprinter';
import type { RankedVaultCandidate } from '../../src/types/unified-investigation.types';
import {
  DNA_ALGORITHM_VERSION,
  DNA_FINGERPRINT_VERSION,
  DNA_SCHEMA_VERSION,
} from '../../src/config/dna-versions';

function probeFp(overrides?: Partial<EphemeralFingerprint>): EphemeralFingerprint {
  return {
    fileType: 'IMAGE',
    mimeType: 'image/jpeg',
    filename: 'probe.jpg',
    sizeBytes: 100,
    detectedBy: 'test',
    layers: Array.from({ length: 15 }, (_, i) => ({
      layer: i + 1,
      name: `L${i + 1}`,
      implementation: `L${i + 1}`,
      fingerprint: `fp${(i + 1).toString().padStart(2, '0')}${'a'.repeat(60)}`.slice(0, 64),
      data: {},
      success: true,
    })),
    ...overrides,
  };
}

function sealedPackage(fps: string[]): EnterpriseDnaPackage {
  return {
    schema: 'enterprise-dna-package-v1',
    dnaId: 'dna-stored',
    ownerId: 'owner-1',
    assetId: 'vault-1',
    mediaType: 'IMAGE',
    creationTime: new Date().toISOString(),
    dnaSchemaVersion: DNA_SCHEMA_VERSION,
    dnaAlgorithmVersion: DNA_ALGORITHM_VERSION,
    fingerprintVersion: DNA_FINGERPRINT_VERSION,
    generatorVersion: 'test',
    integrityVersion: '1',
    dnaPackageVersion: '1',
    storageVersion: '1',
    comparisonVersion: '1',
    generationStatus: 'COMPLETE',
    validationStatus: 'VALID',
    storageStatus: 'SEALED',
    overallIntegrityHash: '1'.repeat(64),
    overallFingerprintHash: '2'.repeat(64),
    integrityMerkleRoot: '3'.repeat(64),
    contentId: fps[0] ?? 'c'.repeat(64),
    layers: fps.map((fp, i) => ({
      layerNumber: i + 1,
      layerName: `L${i + 1}`,
      fingerprint: fp,
      fingerprintAlgorithm: `L${i + 1}`,
      fingerprintVersion: DNA_FINGERPRINT_VERSION,
      fingerprintSize: fp.length,
      generationTime: new Date().toISOString(),
      generationDurationMs: 1,
      deterministic: true,
      validationStatus: 'VALID' as const,
      integrityHash: `${i + 1}`.repeat(64).slice(0, 64),
      storageStatus: 'SEALED' as const,
    })),
    sealedAt: new Date().toISOString(),
  };
}

function candidate(vaultId: string, dnaRecordId: string, score: number): RankedVaultCandidate {
  return {
    rank: 1,
    dnaRecordId,
    vaultId,
    ownerUserId: 'owner-1',
    preliminaryScore: score,
    compositeScore: score,
    tier: 1,
    method: 'enterprise_retrieval',
    signals: ['enterprise_dna'],
  };
}

function makeDeps(opts: {
  fps: string[];
  acceptVerdict?: EnterpriseAcceptanceDecision['verdict'];
  retain?: boolean;
  candidates?: RankedVaultCandidate[];
  compareMutator?: (report: EnterpriseComparisonReport) => EnterpriseComparisonReport;
}): EnterpriseInvestigationPipelineDeps & {
  _counts: { fingerprint: number; retrieve: number; compare: number; accept: number };
} {
  const fps = opts.fps;
  const pkg = sealedPackage(fps);
  const counts = { fingerprint: 0, retrieve: 0, compare: 0, accept: 0 };

  return {
    _counts: counts,
    fingerprintProbe: async () => {
      counts.fingerprint += 1;
      return probeFp({
        layers: fps.map((fp, i) => ({
          layer: i + 1,
          name: `L${i + 1}`,
          implementation: `L${i + 1}`,
          fingerprint: fp,
          data: {},
          success: true,
        })),
      });
    },
    generateVariants: async (buffer, mimeType) => [{ label: 'original', buffer, mimeType }],
    retrieve: async () => {
      counts.retrieve += 1;
      const list = opts.candidates ?? [candidate('vault-1', 'dna-1', 90)];
      return {
        candidates: list,
        providerResults: [{
          provider: 'stored_enterprise_dna',
          candidates: [],
          durationMs: 1,
        }],
        localDnaHits: [],
        visualVectors: [],
        mergedCandidateCount: list.length,
        finalCandidateCount: list.length,
      };
    },
    loadStoredPackage: async () => ({
      pkg,
      packageStatus: 'SEALED',
      detail: 'enterprise_package_valid',
    }),
    compare: (_stored, _probe) => {
      counts.compare += 1;
      const base: EnterpriseComparisonReport = {
        schema: 'enterprise-comparison-report-v1',
        comparisonId: `cmp-${counts.compare}`,
        engineVersion: 'test',
        comparedAt: new Date().toISOString(),
        processingMs: 1,
        versionValidation: { ok: true, reasons: [] },
        layers: Array.from({ length: 15 }, (_, i) => ({
          layerId: i + 1,
          layerName: `L${i + 1}`,
          domain: 'identity' as const,
          mode: 'EXACT' as const,
          score: 100,
          confidence: 100,
          status: 'MATCH' as const,
          reason: 'match',
          evidence: 'match',
          executionTimeMs: 1,
        })),
        domains: {
          identityScore: 95,
          evidenceScore: 40,
          ownershipScore: 100,
          trustScore: 80,
        },
        summary: 'test',
      };
      return opts.compareMutator ? opts.compareMutator(base) : base;
    },
    accept: ({ report, packageCorrupted, packageMissing }) => {
      counts.accept += 1;
      const verdict = packageCorrupted
        ? 'PACKAGE_CORRUPTED'
        : packageMissing
          ? 'INVALID_PACKAGE'
          : (opts.acceptVerdict ?? 'VERIFIED_OWNER');
      const retain = opts.retain ?? (verdict === 'VERIFIED_OWNER' || verdict === 'VERIFIED_COPY' || verdict === 'DERIVATIVE');
      return {
        schema: 'enterprise-acceptance-decision-v1',
        verdict,
        policyVersion: 'test',
        domains: report.domains,
        explanation: {
          decision: verdict,
          reason: `scenario:${verdict}`,
          satisfiedConditions: ['identity_verified'],
          unsatisfiedConditions: [],
          triggeredLayers: [1, 3, 14],
          supportingEvidence: [],
          missingEvidence: [],
        },
        retainCandidate: retain,
        ruleId: 'TEST',
        executionTimeMs: 1,
        comparedAt: new Date().toISOString(),
      };
    },
  };
}

const SCENARIOS: Array<{
  name: string;
  acceptVerdict: EnterpriseAcceptanceDecision['verdict'];
  retain: boolean;
  mutator?: (r: EnterpriseComparisonReport) => EnterpriseComparisonReport;
}> = [
  { name: 'Original', acceptVerdict: 'VERIFIED_OWNER', retain: true },
  {
    name: 'Compressed',
    acceptVerdict: 'VERIFIED_COPY',
    retain: true,
    mutator: (r) => ({
      ...r,
      layers: r.layers.map((l) => (l.layerId === 1 ? { ...l, status: 'MISMATCH', score: 0 } : l)),
      domains: { ...r.domains, identityScore: 85 },
    }),
  },
  {
    name: 'Resized',
    acceptVerdict: 'DERIVATIVE',
    retain: true,
    mutator: (r) => ({
      ...r,
      domains: { identityScore: 70, evidenceScore: 35, ownershipScore: 80, trustScore: 60 },
    }),
  },
  {
    name: 'Cropped',
    acceptVerdict: 'DERIVATIVE',
    retain: true,
    mutator: (r) => ({
      ...r,
      layers: r.layers.map((l) => (l.layerId === 3 ? { ...l, status: 'PARTIAL', score: 72 } : l)),
      domains: { identityScore: 68, evidenceScore: 30, ownershipScore: 75, trustScore: 55 },
    }),
  },
  {
    name: 'Screenshot',
    acceptVerdict: 'POSSIBLE_MATCH',
    retain: false,
    mutator: (r) => ({
      ...r,
      domains: { identityScore: 58, evidenceScore: 20, ownershipScore: 40, trustScore: 45 },
    }),
  },
  {
    name: 'Metadata removed',
    acceptVerdict: 'DERIVATIVE',
    retain: true,
    mutator: (r) => ({
      ...r,
      layers: r.layers.map((l) => (l.layerId === 5 ? { ...l, status: 'NOT_PRESENT', score: 0 } : l)),
    }),
  },
  {
    name: 'Certificate removed',
    acceptVerdict: 'POSSIBLE_MATCH',
    retain: false,
    mutator: (r) => ({
      ...r,
      layers: r.layers.map((l) => (l.layerId === 12 ? { ...l, status: 'NOT_PRESENT', score: 0 } : l)),
      domains: { ...r.domains, ownershipScore: 40 },
    }),
  },
  {
    name: 'Watermark removed',
    acceptVerdict: 'POSSIBLE_MATCH',
    retain: false,
    mutator: (r) => ({
      ...r,
      layers: r.layers.map((l) => (l.layerId === 6 ? { ...l, status: 'MISMATCH', score: 0 } : l)),
    }),
  },
  {
    name: 'Edited derivative',
    acceptVerdict: 'DERIVATIVE',
    retain: true,
    mutator: (r) => ({
      ...r,
      domains: { identityScore: 65, evidenceScore: 45, ownershipScore: 78, trustScore: 50 },
    }),
  },
  {
    name: 'Unrelated asset',
    acceptVerdict: 'NO_MATCH',
    retain: false,
    mutator: (r) => ({
      ...r,
      layers: r.layers.map((l) => ({ ...l, status: 'MISMATCH' as const, score: 0 })),
      domains: { identityScore: 5, evidenceScore: 0, ownershipScore: 0, trustScore: 10 },
    }),
  },
];

describe('enterprise-investigation-pipeline (Milestone G)', () => {
  const fps = Array.from({ length: 15 }, (_, i) =>
    `fp${(i + 1).toString().padStart(2, '0')}${'a'.repeat(60)}`.slice(0, 64),
  );

  it('ENTERPRISE_PIPELINE_V2 defaults OFF', () => {
    expect(isEnterprisePipelineV2Enabled()).toBe(false);
  });

  it('executes each stage once and builds unified report', async () => {
    const deps = makeDeps({ fps, acceptVerdict: 'VERIFIED_OWNER', retain: true });
    const pipeline = new EnterpriseInvestigationPipeline(deps);
    const run = await pipeline.run({
      buffer: Buffer.from('probe'),
      mimeType: 'image/jpeg',
      originalName: 'probe.jpg',
      sizeBytes: 5,
      ownerUserId: 'owner-1',
      investigationId: 'inv-fixed-1',
    });

    expect(run.investigationId).toBe('inv-fixed-1');
    expect(run.report.schema).toBe('enterprise-investigation-report-v1');
    expect(run.report.pipelineVersion).toBe('enterprise-pipeline-v2');
    expect(deps._counts.fingerprint).toBe(1);
    expect(deps._counts.retrieve).toBe(1);
    expect(deps._counts.compare).toBe(1);
    expect(deps._counts.accept).toBe(1);

    const stageNames = run.report.stages.map((s) => s.stage);
    expect(stageNames).toEqual([
      'init',
      'generation_context',
      'storage_load',
      'retrieval',
      'comparison',
      'acceptance',
      'report',
    ]);
    expect(run.report.stages.every((s) =>
      ['SUCCESS', 'WARNING', 'FAILED', 'SKIPPED'].includes(s.status),
    )).toBe(true);
    expect(run.report.totalExecutionMs).toBeGreaterThanOrEqual(0);
    expect(run.report.acceptanceDecision?.verdict).toBe('VERIFIED_OWNER');
    expect(run.report.packageValidation.storedPackageUsed).toBe(true);
    expect(run.report.layerReport).toHaveLength(15);
    expect(run.report.comparisonSummary.candidatesCompared).toBe(1);
  });

  it('degrades gracefully when retrieval returns empty', async () => {
    const deps = makeDeps({ fps, candidates: [] });
    const pipeline = new EnterpriseInvestigationPipeline(deps);
    const run = await pipeline.run({
      buffer: Buffer.from('x'),
      mimeType: 'image/jpeg',
      originalName: 'x.jpg',
      sizeBytes: 1,
      ownerUserId: 'owner-1',
    });
    expect(run.report.stages.find((s) => s.stage === 'comparison')?.status).toBe('SKIPPED');
    expect(run.report.stages.find((s) => s.stage === 'acceptance')?.status).toBe('SKIPPED');
    expect(run.report.acceptanceDecision).toBeNull();
    expect(run.report.stages.find((s) => s.stage === 'report')?.status).toBe('SUCCESS');
  });

  it('selectBestCandidateOutcome prefers retainCandidate', () => {
    const best = selectBestCandidateOutcome([
      {
        vaultId: 'a',
        dnaRecordId: 'd1',
        packageStatus: 'SEALED',
        acceptance: {
          schema: 'enterprise-acceptance-decision-v1',
          verdict: 'NO_MATCH',
          policyVersion: 't',
          domains: { identityScore: 99, evidenceScore: 0, ownershipScore: 0, trustScore: 0 },
          explanation: {
            decision: 'NO_MATCH',
            reason: 'x',
            satisfiedConditions: [],
            unsatisfiedConditions: [],
            triggeredLayers: [],
            supportingEvidence: [],
            missingEvidence: [],
          },
          retainCandidate: false,
          ruleId: 'x',
          executionTimeMs: 1,
          comparedAt: new Date().toISOString(),
        },
      },
      {
        vaultId: 'b',
        dnaRecordId: 'd2',
        packageStatus: 'SEALED',
        acceptance: {
          schema: 'enterprise-acceptance-decision-v1',
          verdict: 'VERIFIED_OWNER',
          policyVersion: 't',
          domains: { identityScore: 80, evidenceScore: 40, ownershipScore: 90, trustScore: 70 },
          explanation: {
            decision: 'VERIFIED_OWNER',
            reason: 'y',
            satisfiedConditions: [],
            unsatisfiedConditions: [],
            triggeredLayers: [],
            supportingEvidence: [],
            missingEvidence: [],
          },
          retainCandidate: true,
          ruleId: 'y',
          executionTimeMs: 1,
          comparedAt: new Date().toISOString(),
        },
      },
    ]);
    expect(best?.vaultId).toBe('b');
  });

  describe('E2E scenario matrix (pipeline completes)', () => {
    for (const scenario of SCENARIOS) {
      it(`${scenario.name} → completes with verdict ${scenario.acceptVerdict}`, async () => {
        const deps = makeDeps({
          fps,
          acceptVerdict: scenario.acceptVerdict,
          retain: scenario.retain,
          compareMutator: scenario.mutator,
        });
        const pipeline = new EnterpriseInvestigationPipeline(deps);
        const run = await pipeline.run({
          buffer: Buffer.from(scenario.name),
          mimeType: 'image/jpeg',
          originalName: `${scenario.name}.jpg`,
          sizeBytes: 10,
          ownerUserId: 'owner-1',
        });

        expect(run.report.stages).toHaveLength(7);
        expect(run.report.stages.find((s) => s.stage === 'report')?.status).toBe('SUCCESS');
        expect(run.report.acceptanceDecision?.verdict).toBe(scenario.acceptVerdict);
        expect(run.report.retrievalSummary.finalCandidateCount).toBe(1);
        expect(run.report.totalExecutionMs).toBeGreaterThanOrEqual(0);

        const id = await pipeline.toIdentificationResult(run, {
          buffer: Buffer.from(scenario.name),
          mimeType: 'image/jpeg',
          originalName: `${scenario.name}.jpg`,
          sizeBytes: 10,
          ownerUserId: 'owner-1',
        });
        expect(id.enterpriseInvestigationReport?.investigationId).toBe(run.investigationId);
        expect(id.stages.length).toBe(7);
        expect(id.fusion.fusionMode).toBe('enterprise');
      });
    }
  });
});
