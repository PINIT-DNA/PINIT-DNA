import { describe, expect, it } from 'vitest';
import { buildEnterpriseInvestigationViewModel } from '../lib/enterprise-investigation-report-model';

describe('buildEnterpriseInvestigationViewModel', () => {
  it('maps existing API report into 11-section view model without inventing layers', () => {
    const vm = buildEnterpriseInvestigationViewModel({
      investigationId: 'inv-1',
      investigatedAt: '2026-07-17T00:00:00.000Z',
      success: true,
      pipeline: [{ id: 'dna_compare', label: '15-layer DNA comparison', status: 'complete', detail: '72%' }],
      summary: {
        reportState: 'POSSIBLE',
        acceptanceVerdict: 'POSSIBLE_MATCH',
        acceptanceConfidence: 65,
        acceptancePolicyVersion: 'acceptance-policy-v1.2',
        decisionReason: 'Closest similarity 65%',
        dnaMatchPercent: 65,
        retrievalConfidence: 95,
        riskLevel: 'MEDIUM',
        ownershipConfidence: 0,
        certificateStatus: 'ACTIVE',
        identityStatus: 'FOUND',
        tamperSeverity: 'CROP',
      },
      owner: { vaultId: 'vault-a', dnaRecordId: 'dna-a', ownerName: 'Test Owner' },
      layerAnalysis: [{ layer: 1, name: 'Cryptographic', matchPercent: 0, status: 'failed', explanation: 'SHA mismatch' }],
      tamperAnalysis: { primaryVector: 'CROP', overallTamperScore: 40, vectors: [{ label: 'Crop', detected: true }] },
      identityProof: { digitalSignatureValid: false, identityVerification: 'PARTIAL', watermark: { status: 'NOT_EMBEDDED' } },
      candidateRanking: [{ rank: 1, vaultId: 'vault-a', dnaRecordId: 'dna-a', compositeScore: 95, method: 'vector', signals: ['perceptual_hash'], selected: true }],
      timeline: [],
    });

    expect(vm.summary.finalVerdict).toContain('POSSIBLE');
    expect(vm.layers).toHaveLength(1);
    expect(vm.retrieval.topCandidates[0].vaultId).toBe('vault-a');
    expect(vm.layersAvailability).toBe('available');
    expect(vm.acceptance.verdict.value).toBe('POSSIBLE_MATCH');
  });

  it('marks missing layer analysis as unavailable', () => {
    const vm = buildEnterpriseInvestigationViewModel({
      investigationId: 'inv-2',
      investigatedAt: '2026-07-17T00:00:00.000Z',
      success: false,
      pipeline: [{ id: 'report', label: 'Generate investigation report', status: 'warning', detail: 'Partial report' }],
      summary: {
        acceptanceVerdict: 'INSUFFICIENT_EVIDENCE',
        riskLevel: 'UNKNOWN',
        ownershipConfidence: 0,
        dnaMatchPercent: 0,
        certificateStatus: 'UNKNOWN',
        identityStatus: 'NOT_FOUND',
        tamperSeverity: 'UNKNOWN',
      },
      owner: {},
      layerAnalysis: [],
      tamperAnalysis: { primaryVector: 'NONE', overallTamperScore: 0, vectors: [] },
      identityProof: { digitalSignatureValid: false, identityVerification: 'NOT_FOUND', watermark: { status: 'NOT_EMBEDDED' } },
      timeline: [],
    });

    expect(vm.layersAvailability).toBe('unavailable');
    expect(vm.summary.status).toMatch(/Incomplete|warning/i);
  });
});
