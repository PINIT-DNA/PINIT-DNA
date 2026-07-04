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
    expect(RANKING_TOP_DEEP).toBe(10);
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

  it('uses per-candidate compare and stops at first winner (no batch timeout loss)', async () => {
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
    expect(result.logs[0]?.dnaScore).toBe(55);
    expect(result.logs[0]?.dnaClassification).toBe('SIMILAR');
    expect(compareCalls).toBe(1); // stopped after winner — no wasted compares
  });
});

