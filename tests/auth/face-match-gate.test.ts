/**
 * Unit tests for face ranking / confident-match gate (wrong-face login defense).
 */
import {
  rankFaceMatches,
  isConfidentFaceMatch,
  normalizeEmbedding,
  THRESHOLDS,
} from '../../src/services/auth/biometric-matching.service';

function vec(seed: number): number[] {
  const out = new Array(128).fill(0).map((_, i) => Math.sin(seed * 17 + i) * 0.5);
  return normalizeEmbedding(out);
}

describe('face match confidence gate', () => {
  it('accepts a clear nearest match under threshold with margin', () => {
    const probe = vec(1);
    const same = probe.map((v, i) => v + (i % 7 === 0 ? 0.002 : 0));
    const other = vec(99);
    const ranked = rankFaceMatches(normalizeEmbedding(probe), [
      { userId: 'a', shortId: 'PINIT-A', embedding: normalizeEmbedding(same) },
      { userId: 'b', shortId: 'PINIT-B', embedding: normalizeEmbedding(other) },
    ]);
    expect(ranked.best?.userId).toBe('a');
    expect(isConfidentFaceMatch(ranked.best!.distance, ranked.secondDistance)).toBe(true);
  });

  it('rejects when only a weak nearest stranger exists (above login threshold)', () => {
    const probe = vec(1);
    const stranger = vec(50);
    const ranked = rankFaceMatches(normalizeEmbedding(probe), [
      { userId: 'x', shortId: 'PINIT-X', embedding: normalizeEmbedding(stranger) },
    ]);
    expect(ranked.best).not.toBeNull();
    // Random different embeddings should sit well above a tight login threshold
    expect(ranked.best!.distance).toBeGreaterThanOrEqual(THRESHOLDS.faceLogin);
    expect(isConfidentFaceMatch(ranked.best!.distance, ranked.secondDistance)).toBe(false);
  });

  it('rejects ambiguous top-2 when margin is too small even if under threshold', () => {
    // Force distances manually via isConfidentFaceMatch
    const under = Math.max(0, THRESHOLDS.faceLogin - 0.02);
    const nearSecond = under + 0.01; // margin 0.01 < default 0.08
    expect(isConfidentFaceMatch(under, nearSecond)).toBe(false);
  });
});
