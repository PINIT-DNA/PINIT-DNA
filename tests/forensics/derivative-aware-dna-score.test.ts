/**
 * Vault derivatives must not be scored with L1/L6 weight (always 0 after edit).
 */
import { derivativeAwareScore } from '../../src/services/forensics/deep-vault-compare.service';

function layers(partial: Record<number, number>) {
  return [1, 2, 3, 4, 5, 6].map((layer) => ({
    layer,
    similarityPercent: partial[layer] ?? 0,
    matched: (partial[layer] ?? 0) >= 100,
  }));
}

describe('derivativeAwareScore', () => {
  it('lifts WhatsApp/crop overall from ~14% to perceptual content score', () => {
    // Matches production log: L3=47%, L5=100%, overall 14% DIFFERENT
    const result = derivativeAwareScore(
      layers({ 3: 47, 5: 100 }),
      14,
      'DIFFERENT',
    );
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.classification).toBe('SIMILAR');
  });

  it('keeps exact L1 match on overall score', () => {
    const result = derivativeAwareScore(
      layers({ 1: 100, 2: 100, 3: 100, 5: 100, 6: 100 }),
      100,
      'DNA_MATCH',
    );
    expect(result.score).toBe(100);
    expect(result.classification).toBe('DNA_MATCH');
  });

  it('does not promote unrelated low-perceptual pairs', () => {
    const result = derivativeAwareScore(
      layers({ 3: 18, 5: 100 }),
      8,
      'DIFFERENT',
    );
    expect(result.score).toBeLessThan(40);
    expect(result.classification).toBe('DIFFERENT');
  });
});
