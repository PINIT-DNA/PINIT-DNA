/**
 * Milestone F — Enterprise Acceptance Engine.
 */
import {
  decideEnterpriseAcceptance,
  mapEnterpriseVerdictToLegacy,
} from '../../src/services/forensics/enterprise-acceptance-engine.service';
import type { EnterpriseComparisonReport } from '../../src/types/enterprise-comparison.types';
import type { EnterpriseLayerCompareResult } from '../../src/types/enterprise-comparison.types';

function layer(
  id: number,
  status: EnterpriseLayerCompareResult['status'],
  score: number,
  domain: EnterpriseLayerCompareResult['domain'] = 'identity',
): EnterpriseLayerCompareResult {
  return {
    layerId: id,
    layerName: `L${id}`,
    domain: id === 5 || id === 11 || id === 13
      ? 'evidence'
      : id === 12 || id === 14
        ? 'ownership'
        : id === 15
          ? 'trust'
          : domain,
    mode: 'EXACT',
    score,
    confidence: score,
    status,
    reason: status,
    evidence: status,
    executionTimeMs: 1,
  };
}

function report(
  layers: EnterpriseLayerCompareResult[],
  domains: EnterpriseComparisonReport['domains'],
): EnterpriseComparisonReport {
  const filled = Array.from({ length: 15 }, (_, i) => {
    const id = i + 1;
    return layers.find((l) => l.layerId === id) ?? layer(id, 'NOT_PRESENT', 0);
  });
  return {
    schema: 'enterprise-comparison-report-v1',
    comparisonId: 'test-cmp',
    engineVersion: 'test',
    comparedAt: new Date().toISOString(),
    processingMs: 1,
    versionValidation: { ok: true, reasons: [] },
    layers: filled,
    domains,
    summary: 'test',
  };
}

describe('enterprise-acceptance-engine (Milestone F)', () => {
  it('original owner → VERIFIED_OWNER', () => {
    const decision = decideEnterpriseAcceptance({
      report: report(
        [
          layer(1, 'MATCH', 100),
          layer(3, 'MATCH', 100),
          layer(6, 'MATCH', 100),
          layer(12, 'MATCH', 100),
          layer(14, 'MATCH', 100),
        ],
        { identityScore: 95, evidenceScore: 40, ownershipScore: 100, trustScore: 80 },
      ),
    });
    expect(decision.verdict).toBe('VERIFIED_OWNER');
    expect(decision.retainCandidate).toBe(true);
    expect(decision.explanation.satisfiedConditions).toContain('identity_verified');
    expect(decision.explanation.triggeredLayers.length).toBeGreaterThan(0);
    expect(mapEnterpriseVerdictToLegacy(decision.verdict)).toBe('VERIFIED_ORIGINAL');
  });

  it('shared / compressed copy → VERIFIED_COPY', () => {
    const decision = decideEnterpriseAcceptance({
      report: report(
        [
          layer(1, 'MISMATCH', 0),
          layer(3, 'MATCH', 92),
          layer(4, 'PARTIAL', 70),
          layer(12, 'MATCH', 100),
        ],
        { identityScore: 80, evidenceScore: 30, ownershipScore: 90, trustScore: 60 },
      ),
    });
    expect(decision.verdict).toBe('VERIFIED_COPY');
    expect(decision.explanation.unsatisfiedConditions).toContain('l1_exact');
  });

  it('cropped derivative → DERIVATIVE', () => {
    const decision = decideEnterpriseAcceptance({
      report: report(
        [
          layer(1, 'MISMATCH', 0),
          layer(3, 'PARTIAL', 60),
          layer(7, 'MATCH', 75),
          layer(12, 'MATCH', 100),
        ],
        { identityScore: 62, evidenceScore: 20, ownershipScore: 85, trustScore: 50 },
      ),
    });
    expect(decision.verdict).toBe('DERIVATIVE');
    expect(decision.explanation.satisfiedConditions).toContain('fragment_identity_l7');
  });

  it('metadata removed still can POSSIBLE_MATCH without ownership', () => {
    const decision = decideEnterpriseAcceptance({
      report: report(
        [
          layer(1, 'MISMATCH', 0),
          layer(3, 'MATCH', 80),
          layer(5, 'NOT_PRESENT', 0),
        ],
        { identityScore: 70, evidenceScore: 0, ownershipScore: 0, trustScore: 0 },
      ),
    });
    expect(decision.verdict).toBe('POSSIBLE_MATCH');
    expect(decision.retainCandidate).toBe(false);
    expect(decision.explanation.missingEvidence.some((m) => m.includes('ownership'))).toBe(true);
  });

  it('certificate removed with identity only → POSSIBLE_MATCH', () => {
    const decision = decideEnterpriseAcceptance({
      report: report(
        [
          layer(1, 'MATCH', 100),
          layer(3, 'MATCH', 90),
          layer(13, 'NOT_PRESENT', 0),
          layer(12, 'NOT_PRESENT', 0),
          layer(14, 'NOT_PRESENT', 0),
        ],
        { identityScore: 95, evidenceScore: 0, ownershipScore: 0, trustScore: 0 },
      ),
    });
    expect(decision.verdict).toBe('POSSIBLE_MATCH');
  });

  it('watermark removed but certificate hint → VERIFIED_OWNER', () => {
    const decision = decideEnterpriseAcceptance({
      report: report(
        [
          layer(1, 'MATCH', 100),
          layer(12, 'NOT_PRESENT', 0),
          layer(14, 'NOT_PRESENT', 0),
        ],
        { identityScore: 95, evidenceScore: 10, ownershipScore: 0, trustScore: 50 },
      ),
      ownershipHints: { certificateBound: true },
    });
    expect(decision.verdict).toBe('VERIFIED_OWNER');
  });

  it('edited derivative with ownership → DERIVATIVE', () => {
    const decision = decideEnterpriseAcceptance({
      report: report(
        [
          layer(1, 'MISMATCH', 0),
          layer(2, 'PARTIAL', 60),
          layer(3, 'PARTIAL', 65),
          layer(10, 'MATCH', 100),
          layer(14, 'MATCH', 100),
        ],
        { identityScore: 58, evidenceScore: 40, ownershipScore: 90, trustScore: 55 },
      ),
    });
    expect(decision.verdict).toBe('DERIVATIVE');
  });

  it('unrelated file → NO_MATCH', () => {
    const decision = decideEnterpriseAcceptance({
      report: report(
        [
          layer(1, 'MISMATCH', 0),
          layer(2, 'MISMATCH', 10),
          layer(3, 'MISMATCH', 12),
        ],
        { identityScore: 15, evidenceScore: 0, ownershipScore: 0, trustScore: 0 },
      ),
    });
    expect(decision.verdict).toBe('NO_MATCH');
    expect(mapEnterpriseVerdictToLegacy(decision.verdict)).toBe('NOT_PINIT');
  });

  it('corrupted package → PACKAGE_CORRUPTED', () => {
    const decision = decideEnterpriseAcceptance({
      report: report([], { identityScore: 0, evidenceScore: 0, ownershipScore: 0, trustScore: 0 }),
      packageCorrupted: true,
    });
    expect(decision.verdict).toBe('PACKAGE_CORRUPTED');
    expect(decision.explanation.unsatisfiedConditions).toContain('integrity_valid');
  });

  it('missing package → INVALID_PACKAGE', () => {
    const decision = decideEnterpriseAcceptance({
      report: report([], { identityScore: 0, evidenceScore: 0, ownershipScore: 0, trustScore: 0 }),
      packageMissing: true,
    });
    expect(decision.verdict).toBe('INVALID_PACKAGE');
  });

  it('every decision includes full explanation contract', () => {
    const decision = decideEnterpriseAcceptance({
      report: report(
        [layer(3, 'PARTIAL', 60)],
        { identityScore: 60, evidenceScore: 0, ownershipScore: 0, trustScore: 0 },
      ),
    });
    expect(decision.explanation).toEqual(expect.objectContaining({
      decision: expect.any(String),
      reason: expect.any(String),
      satisfiedConditions: expect.any(Array),
      unsatisfiedConditions: expect.any(Array),
      triggeredLayers: expect.any(Array),
      supportingEvidence: expect.any(Array),
      missingEvidence: expect.any(Array),
    }));
    // Domains remain independent on the decision
    expect(decision.domains).toEqual({
      identityScore: 60,
      evidenceScore: 0,
      ownershipScore: 0,
      trustScore: 0,
    });
  });
});
