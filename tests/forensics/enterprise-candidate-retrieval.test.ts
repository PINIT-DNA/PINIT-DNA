import {
  mergeEnterpriseProviderCandidates,
  runEnterpriseCandidateProviders,
  type CandidateProvider,
  type EnterpriseCandidateProviderResult,
} from '../../src/services/forensics/enterprise-candidate-retrieval.service';
import { buildDeepComparePool } from '../../src/services/forensics/candidate-ranking-engine.service';

function result(
  provider: EnterpriseCandidateProviderResult['provider'],
  candidates: Array<{ id: string; confidence: number; signal?: string }>,
): EnterpriseCandidateProviderResult {
  return {
    provider,
    durationMs: 1,
    candidates: candidates.map((candidate) => ({
      provider,
      vaultId: `vault-${candidate.id}`,
      dnaRecordId: `dna-${candidate.id}`,
      ownerUserId: 'owner-1',
      retrievalConfidence: candidate.confidence,
      method: provider,
      signals: [candidate.signal ?? provider],
    })),
  };
}

describe('Enterprise candidate retrieval (Milestone D)', () => {
  it('unions all providers and removes duplicate vault candidates', () => {
    const merged = mergeEnterpriseProviderCandidates([
      result('sha256_exact', [{ id: 'exact', confidence: 100 }]),
      result('perceptual_fingerprint', [
        { id: 'near', confidence: 72 },
        { id: 'shared', confidence: 65, signal: 'perceptual_hash' },
      ]),
      result('local_feature', [
        { id: 'crop', confidence: 68 },
        { id: 'shared', confidence: 80, signal: 'local_feature' },
      ]),
      result('metadata', [{ id: 'metadata', confidence: 45 }]),
    ], 100);

    expect(merged.mergedCandidateCount).toBe(5);
    expect(merged.merged.map((candidate) => candidate.vaultId)).toEqual([
      'vault-exact',
      'vault-shared',
      'vault-near',
      'vault-crop',
      'vault-metadata',
    ]);
    const shared = merged.merged.find((candidate) => candidate.vaultId === 'vault-shared');
    expect(shared?.compositeScore).toBe(80);
    expect(shared?.signals).toEqual(expect.arrayContaining([
      'perceptual_hash',
      'local_feature',
      'provider:perceptual_fingerprint',
      'provider:local_feature',
    ]));
  });

  it('applies the candidate limit only after provider union', () => {
    const merged = mergeEnterpriseProviderCandidates([
      result('perceptual_fingerprint', [
        { id: 'p1', confidence: 50 },
        { id: 'p2', confidence: 40 },
      ]),
      result('local_feature', [{ id: 'crop', confidence: 90 }]),
      result('metadata', [{ id: 'meta', confidence: 60 }]),
    ], 2);

    expect(merged.mergedCandidateCount).toBe(4);
    expect(merged.merged.map((candidate) => candidate.vaultId)).toEqual([
      'vault-crop',
      'vault-meta',
    ]);
  });

  it('continues when one provider fails', async () => {
    const providers: CandidateProvider[] = [
      {
        name: 'ann',
        enabled: true,
        retrieve: async () => {
          throw new Error('ANN offline');
        },
      },
      {
        name: 'sha256_exact',
        enabled: true,
        retrieve: async () => result('sha256_exact', [
          { id: 'exact', confidence: 100 },
        ]).candidates,
      },
      {
        name: 'ocr',
        enabled: false,
        retrieve: async () => {
          throw new Error('disabled provider must not execute');
        },
      },
    ];

    const results = await runEnterpriseCandidateProviders(providers);
    expect(results).toHaveLength(3);
    expect(results.find((entry) => entry.provider === 'ann')?.error).toContain('ANN offline');
    expect(results.find((entry) => entry.provider === 'sha256_exact')?.candidates).toHaveLength(1);
    expect(results.find((entry) => entry.provider === 'ocr')?.candidates).toEqual([]);
  });

  it('keeps one representative from every contributing provider for deep compare', () => {
    const providers: EnterpriseCandidateProviderResult['provider'][] = [
      'stored_enterprise_dna',
      'perceptual_fingerprint',
      'visual_fingerprint',
      'metadata',
      'ocr',
      'local_feature',
      'legacy_registry',
    ];
    const candidates = providers.map((provider, index) => ({
      rank: index + 1,
      vaultId: `vault-${provider}`,
      dnaRecordId: `dna-${provider}`,
      ownerUserId: 'owner-1',
      preliminaryScore: 90 - index,
      compositeScore: 90 - index,
      tier: 3 as const,
      method: provider,
      signals: [`provider:${provider}`],
    }));

    const deepPool = buildDeepComparePool(candidates, 4);
    expect(deepPool).toHaveLength(providers.length);
    expect(new Set(deepPool.flatMap((candidate) => candidate.signals))).toEqual(
      new Set(providers.map((provider) => `provider:${provider}`)),
    );
  });

  it.each([
    ['exact match', 'sha256_exact'],
    ['near duplicate', 'perceptual_fingerprint'],
    ['compressed image', 'visual_fingerprint'],
    ['resized image', 'perceptual_fingerprint'],
    ['cropped image', 'local_feature'],
    ['screenshot', 'ann'],
    ['metadata removed', 'stored_enterprise_dna'],
  ] as const)('keeps %s candidate from the %s provider', (_caseName, provider) => {
    const merged = mergeEnterpriseProviderCandidates([
      result(provider, [{ id: 'original', confidence: 70 }]),
      result('metadata', []),
    ]);
    expect(merged.merged.some((candidate) => candidate.vaultId === 'vault-original')).toBe(true);
  });
});
