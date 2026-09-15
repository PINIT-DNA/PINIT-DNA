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

  it('rejects ambiguous top-2 when margin is too small even if nearest is under threshold', () => {
    const under = Math.max(0, THRESHOLDS.faceLogin - 0.03);
    const justAbove = THRESHOLDS.faceLogin + 0.01; // above threshold, but margin too small
    expect(isConfidentFaceMatch(under, justAbove)).toBe(false);
  });

  it('rejects when two different users both sit under the login threshold', () => {
    const under = Math.max(0, THRESHOLDS.faceLogin - 0.05);
    const alsoUnder = Math.max(0, THRESHOLDS.faceLogin - 0.01);
    expect(isConfidentFaceMatch(under, alsoUnder)).toBe(false);
  });

  it('does not accept a lone gallery user just because secondDistance is Infinity', () => {
    expect(isConfidentFaceMatch(0.1, Infinity)).toBe(false);
  });
});
