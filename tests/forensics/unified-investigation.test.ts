/**
 * Unified Investigation orchestrator — unit tests (mocked services)
 */
import { UnifiedInvestigationOrchestrator } from '../../src/services/forensics/unified-investigation.orchestrator';

jest.mock('../../src/services/forensics/leaked-file-verify.service', () => ({
  leakedFileVerifyService: {
    verify: jest.fn().mockResolvedValue({
      found: false,
      message: 'No identity',
      accessHistory: [],
    }),
  },
}));

jest.mock('../../src/services/forensics/vault-auto-match.service', () => ({
  vaultAutoMatchService: {
    findMatch: jest.fn().mockResolvedValue(null),
  },
}));

describe('UnifiedInvestigationOrchestrator', () => {
  const orchestrator = new UnifiedInvestigationOrchestrator();

  it('returns no-match report with pipeline steps when vault match fails', async () => {
    const report = await orchestrator.investigate(
      Buffer.from('test'),
      'text/plain',
      'suspect.txt',
      'user-1',
    );

    expect(report.success).toBe(false);
    expect(report.pipeline.length).toBeGreaterThanOrEqual(4);
    expect(report.pipeline.some((s) => s.id === 'identity')).toBe(true);
    expect(report.pipeline.some((s) => s.id === 'vault_search')).toBe(true);
    expect(report.leakIntelligence.message).toMatch(/No public leak/);
    // Phase 2 — immutable manifest is single source of truth
    expect(report.manifest).toBeDefined();
    expect(report.manifest?.verdict).toBe('NOT_PINIT');
    expect(report.manifest?.acceptancePolicyVersion).toBe('acceptance-policy-v1.0');
    expect(report.manifest?.dnaAlgorithmVersion).toBe('15-layer-v1');
    expect(report.manifest?.investigationId).toBe(report.investigationId);
    expect(Object.isFrozen(report.manifest)).toBe(true);
  });
});

