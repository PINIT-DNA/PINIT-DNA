/**
 * Candidate Ranking Engine — Phase 4
 * Never stop at #1; DNA DIFFERENT rejects even with high similarity.
 */
import {
  selectWinnerByRanking,
  stageCandidates,
  RANKING_TOP_VECTOR,
  RANKING_TOP_DEEP,
} from '../../src/services/forensics/candidate-ranking-engine.service';
import type { RankedVaultCandidate } from '../../src/types/unified-investigation.types';
import type { VaultSimilarityVector } from '../../src/services/forensics/vault-similarity-vector.service';
import type { DeepCompareResult } from '../../src/services/forensics/deep-vault-compare.service';
import type { LocalDnaSearchHit } from '../../src/services/forensics/vault-local-dna-search.service';

function candidate(
  id: string,
  score: number,
  rank: number,
): RankedVaultCandidate {
  return {
    rank,
    vaultId: `vault-${id}`,
    dnaRecordId: `dna-${id}`,
    ownerUserId: 'owner-1',
    preliminaryScore: score,
    compositeScore: score,
    tier: 3,
    method: 'vector',
    signals: ['perceptual_hash', 'local_features'],
  };
}

function vector(id: string, composite: number, orb = 50): VaultSimilarityVector {
  return {
    vaultId: `vault-${id}`,
    dnaRecordId: `dna-${id}`,
    ownerUserId: 'owner-1',
    filename: `file-${id}.jpg`,
    scores: {
      sha256: 0,
      pHash: composite,
      aHash: 0,
      dHash: 0,
      perceptualBlend: composite,
      structural: composite,
      semanticColor: 0,
      clip: 0,
      orb,
      aspectRatio: 100,
      composite,
    },
    signals: ['perceptual_hash'],
  };
}

function deep(
  id: string,
  score: number,
  classification: string,
): DeepCompareResult {
  return {
    vaultId: `vault-${id}`,
    dnaRecordId: `dna-${id}`,
    overallConfidenceScore: score,
    classification,
    tamperingDetected: score < 95,
    matchedLayerCount: score >= 40 ? 8 : 2,
    totalLayers: 15,
  };
}

describe('CandidateRankingEngine', () => {
  it('stages candidates into a funnel (never full vault deep compare)', () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      candidate(String(i), 90 - (i % 40), i + 1),
    );
    const staged = stageCandidates({ candidates: many, identityHit: null, mediaType: 'image' });
    expect(staged.length).toBeLessThanOrEqual(20);
    expect(staged.length).toBeGreaterThan(0);
    expect(RANKING_TOP_VECTOR).toBe(100);
    expect(RANKING_TOP_DEEP).toBe(6);
  });

  it('rejects high-similarity low-DNA candidate and accepts later winner', async () => {
    const candidates = [
      candidate('wrong', 95, 1),
      candidate('right', 70, 2),
    ];
    const vectors = [vector('wrong', 95, 90), vector('right', 70, 80)];
    const deepResults = [
      deep('wrong', 18, 'DIFFERENT'),
      deep('right', 72, 'SIMILAR'),
    ];

    const result = await selectWinnerByRanking({
      candidates,
      vectors,
      deepCompareResults: deepResults,
      localDnaHit: null,
      localDnaScore: 0,
      identityHit: null,
      isExactVaultMatch: false,
      mediaType: 'image',
    });

    expect(result.winner?.vaultId).toBe('vault-right');
    expect(result.logs[0]?.decision).toBe('REJECT');
    expect(result.logs[0]?.dnaScore).toBe(18);
    expect(result.logs[0]?.vectorSimilarity).toBe(95);
    expect(result.logs.some((l) => l.decision === 'ACCEPT' && l.vaultId === 'vault-right')).toBe(true);
  });

  it('returns no winner when all candidates fail DNA', async () => {
    const candidates = [candidate('a', 90, 1), candidate('b', 85, 2)];
    const vectors = [vector('a', 90), vector('b', 85)];
    const deepResults = [deep('a', 10, 'DIFFERENT'), deep('b', 12, 'DIFFERENT')];

    const result = await selectWinnerByRanking({
      candidates,
      vectors,
      deepCompareResults: deepResults,
      localDnaHit: null,
      localDnaScore: 0,
      identityHit: null,
      isExactVaultMatch: false,
      mediaType: 'image',
    });

    expect(result.winner).toBeNull();
    expect(result.source).toBe('none');
    expect(result.logs.every((l) => l.decision === 'REJECT')).toBe(true);
  });

  it('accepts SHA-256 exact without walking others', async () => {
    const identityHit = {
      tier: 1 as const,
      method: 'SHA-256',
      vaultId: 'vault-exact',
      dnaRecordId: 'dna-exact',
      ownerUserId: 'owner-1',
      confidence: '100',
    };
    const result = await selectWinnerByRanking({
      candidates: [candidate('other', 99, 1)],
      vectors: [vector('other', 99)],
      deepCompareResults: [],
      localDnaHit: null,
      localDnaScore: 0,
      identityHit,
      isExactVaultMatch: true,
      mediaType: 'image',
    });
    expect(result.winner?.vaultId).toBe('vault-exact');
    expect(result.source).toBe('sha256_exact');
  });

  it('uses per-candidate compare for weak leads (full deep pool)', async () => {
    const candidates = [candidate('correct', 52, 1), candidate('other', 30, 2)];
    const vectors = [vector('correct', 52, 0), vector('other', 30)];
    let compareCalls = 0;
    const result = await selectWinnerByRanking({
      candidates,
      vectors,
      localDnaHit: null,
      localDnaScore: 0,
      identityHit: null,
      isExactVaultMatch: false,
      mediaType: 'image',
      compareCandidate: async (c) => {
        compareCalls++;
        if (c.vaultId === 'vault-correct') {
          return deep('correct', 55, 'SIMILAR');
        }
        return deep('other', 18, 'DIFFERENT');
      },
    });
    expect(result.winner?.vaultId).toBe('vault-correct');
    expect(result.logs.some((l) => l.vaultId === 'vault-correct' && l.decision === 'ACCEPT')).toBe(true);
    expect(compareCalls).toBeGreaterThanOrEqual(1);
  });

  it('uses deep pool of 4 when vector lead is trusted (≥75%)', async () => {
    const candidates = [
      candidate('lead', 80, 1),
      candidate('b', 40, 2),
      candidate('c', 30, 3),
      candidate('d', 20, 4),
      candidate('e', 15, 5),
    ];
    const vectors = [
      vector('lead', 80),
      vector('b', 40),
      vector('c', 30),
      vector('d', 20),
      vector('e', 15),
    ];
    let compareCalls = 0;
    const result = await selectWinnerByRanking({
      candidates,
      vectors,
      localDnaHit: null,
      localDnaScore: 0,
      identityHit: null,
      isExactVaultMatch: false,
      mediaType: 'image',
      compareCandidate: async (c) => {
        compareCalls++;
        if (c.vaultId === 'vault-lead') return deep('lead', 80, 'SIMILAR');
        return deep(c.vaultId.replace('vault-', ''), 10, 'DIFFERENT');
      },
    });
    expect(result.winner?.vaultId).toBe('vault-lead');
    expect(result.deepComparePool.length).toBe(4);
    expect(compareCalls).toBeGreaterThanOrEqual(1);
  });

  it('rescues heavy crop via local patch DNA when full-frame DNA is weak', async () => {
    // Wrong vault leads on global vector; true original only wins via patch votes.
    const candidates = [
      candidate('wrong', 36, 1),
      candidate('original', 22, 2),
    ];
    const vectors = [vector('wrong', 36), vector('original', 22)];
    const localDnaHit: LocalDnaSearchHit = {
      vaultId: 'vault-original',
      dnaRecordId: 'dna-original',
      ownerUserId: 'owner-1',
      patchMatchCount: 12,
      probePatchCount: 40,
      vaultPatchCount: 200,
      matchRatio: 0.35,
      coverageRatio: 0.3,
      spatialConsistency: 0.6,
      geometricScore: 50,
      orbRefineScore: 48,
      compositeScore: 62,
      signals: ['local_patch_dna'],
    };

    const result = await selectWinnerByRanking({
      candidates,
      vectors,
      localDnaHit,
      localDnaScore: 62,
      identityHit: null,
      isExactVaultMatch: false,
      mediaType: 'image',
      compareCandidate: async (c) => {
        // Full-frame DNA fails on both (heavy crop) — patch rescue must still accept original.
        // No L3 layers: small crops often have weak/missing full-frame perceptual.
        return deep(c.vaultId.replace('vault-', ''), 28, 'DIFFERENT');
      },
    });

    expect(result.winner?.vaultId).toBe('vault-original');
    expect(result.source).toBe('local_patch');
  });

  it('rejects mid-band lookalike SIMILAR without local-patch (L3 59)', async () => {
    const candidates = [candidate('lookalike', 72, 1)];
    const vectors = [vector('lookalike', 72, 60)];
    const deepWithL3 = (id: string, score: number, classification: string, l3: number): DeepCompareResult => ({
      vaultId: `vault-${id}`,
      dnaRecordId: `dna-${id}`,
      overallConfidenceScore: score,
      classification,
      tamperingDetected: true,
      matchedLayerCount: 4,
      totalLayers: 15,
      layerComparisons: [
        { layer: 3, name: 'Perceptual', similarityPercent: l3, matched: l3 >= 75 },
        { layer: 5, name: 'Metadata', similarityPercent: 100, matched: true },
      ],
    });

    const result = await selectWinnerByRanking({
      candidates,
      vectors,
      localDnaHit: null,
      localDnaScore: 0,
      identityHit: null,
      isExactVaultMatch: false,
      mediaType: 'image',
      compareCandidate: async () => deepWithL3('lookalike', 61, 'SIMILAR', 59),
    });

    expect(result.winner).toBeNull();
    expect(result.source).toBe('none');
  });
});

