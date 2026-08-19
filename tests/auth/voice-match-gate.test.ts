/**
 * Unit tests for voice ranking / duplicate-enrollment gate (one-voice-per-account defense).
 * Mirrors face-match-gate.test.ts's structure and conventions.
 */
import {
  rankVoiceMatches,
  isDuplicateVoiceEnrollment,
  normalizeEmbedding,
  THRESHOLDS,
} from '../../src/services/auth/biometric-matching.service';

function vec(seed: number): number[] {
  const out = new Array(128).fill(0).map((_, i) => Math.sin(seed * 17 + i) * 0.5);
  return normalizeEmbedding(out);
}

describe('voice match duplicate-enrollment gate', () => {
  it('flags a clear nearest match under the voice-duplicate threshold with margin', () => {
    const probe = vec(1);
    const same = probe.map((v, i) => v + (i % 7 === 0 ? 0.002 : 0));
    const other = vec(99);
    const ranked = rankVoiceMatches(normalizeEmbedding(probe), [
      { userId: 'a', shortId: 'PINIT-A', embedding: normalizeEmbedding(same) },
      { userId: 'b', shortId: 'PINIT-B', embedding: normalizeEmbedding(other) },
    ]);
    expect(ranked.best?.userId).toBe('a');
    expect(isDuplicateVoiceEnrollment(ranked.best!.distance, ranked.secondDistance)).toBe(true);
  });

  it('does not flag a lone weak stranger (above the voice-duplicate threshold)', () => {
    const probe = vec(1);
    const stranger = vec(50);
    const ranked = rankVoiceMatches(normalizeEmbedding(probe), [
      { userId: 'x', shortId: 'PINIT-X', embedding: normalizeEmbedding(stranger) },
    ]);
    expect(ranked.best).not.toBeNull();
    expect(ranked.best!.distance).toBeGreaterThanOrEqual(THRESHOLDS.voiceDuplicate);
    expect(isDuplicateVoiceEnrollment(ranked.best!.distance, ranked.secondDistance)).toBe(false);
  });

  it('does not flag ambiguous top-2 when margin is too small even if nearest is under threshold', () => {
    const under = Math.max(0, THRESHOLDS.voiceDuplicate - 0.03);
    const justAbove = THRESHOLDS.voiceDuplicate + 0.01;
    expect(isDuplicateVoiceEnrollment(under, justAbove)).toBe(false);
  });

  it('does not flag when two different users both sit under the duplicate threshold', () => {
    const under = Math.max(0, THRESHOLDS.voiceDuplicate - 0.05);
    const alsoUnder = Math.max(0, THRESHOLDS.voiceDuplicate - 0.01);
    expect(isDuplicateVoiceEnrollment(under, alsoUnder)).toBe(false);
  });

  it('does not flag a lone gallery user just because secondDistance is Infinity', () => {
    expect(isDuplicateVoiceEnrollment(0.1, Infinity)).toBe(false);
  });
});
