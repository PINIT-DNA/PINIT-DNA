/**
 * Unified Investigation orchestrator — unit tests (mocked services)
 */
import { UnifiedInvestigationOrchestrator } from '../../src/services/forensics/unified-investigation.orchestrator';
import { DNA_ACCEPTANCE_VERSION } from '../../src/config/dna-versions';

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

  it('returns no-match report with manifest and 15 DNA layers', async () => {
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
    // Pinned to the shipped constant so a deliberate policy bump doesn't silently rot this test.
    expect(report.manifest?.acceptancePolicyVersion).toBe(DNA_ACCEPTANCE_VERSION);
    expect(report.manifest?.dnaAlgorithmVersion).toBe('15-layer-v1');
    expect(report.manifest?.investigationId).toBe(report.investigationId);
    expect(Object.isFrozen(report.manifest)).toBe(true);
    // Phase 3 — exactly 15 standardized DNA layers
    expect(report.manifest?.layers).toHaveLength(15);
    for (const layer of report.manifest!.layers) {
      expect(['PASS', 'FAIL', 'SKIPPED']).toContain(layer.status);
      expect(layer.reason).toBeTruthy();
    }
  }, 30_000);
});
