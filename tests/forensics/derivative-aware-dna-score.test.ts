/**
 * Vault derivatives must not be scored with L1/L6 weight (always 0 after edit).
 * Mid-band L3 must NOT promote DIFFERENT→SIMILAR (lookalike padlock vs wordcloud crop).
 */
import {
  derivativeAwareScore,
  mergeLiveAndRegistryDna,
} from '../../src/services/forensics/deep-vault-compare.service';

function layers(partial: Record<number, number>) {
  return [1, 2, 3, 4, 5, 6].map((layer) => ({
    layer,
    similarityPercent: partial[layer] ?? 0,
    matched: (partial[layer] ?? 0) >= 100,
  }));
}

describe('derivativeAwareScore', () => {
  it('lifts WhatsApp/crop overall from ~14% to perceptual content score', () => {
    const result = derivativeAwareScore(
      layers({ 3: 47, 5: 100 }),
      14,
      'DIFFERENT',
    );
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.classification).toBe('DIFFERENT');
  });

  it('does not promote mid-band lookalike (L3~59 + L5=100) to SIMILAR', () => {
    const result = derivativeAwareScore(
      layers({ 2: 66, 3: 59, 4: 52, 5: 100 }),
      14,
      'DIFFERENT',
    );
    expect(result.score).toBeGreaterThanOrEqual(52);
    expect(result.classification).toBe('DIFFERENT');
  });

  it('promotes to SIMILAR only when perceptual is strongly matched (≥75)', () => {
    const result = derivativeAwareScore(
      layers({ 3: 78, 5: 100 }),
      14,
      'DIFFERENT',
    );
    expect(result.score).toBeGreaterThanOrEqual(75);
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

describe('mergeLiveAndRegistryDna', () => {
  it('forces DIFFERENT when live/registry disagree with weak L3', () => {
    const merged = mergeLiveAndRegistryDna({
      liveAware: { score: 61, classification: 'DIFFERENT' },
      liveL3: 59,
      registryAware: { score: 70, classification: 'SIMILAR' },
      registryL3: 58,
    });
    expect(merged.classification).toBe('DIFFERENT');
  });

  it('takes max score when both agree SIMILAR', () => {
    const merged = mergeLiveAndRegistryDna({
      liveAware: { score: 80, classification: 'SIMILAR' },
      liveL3: 78,
      registryAware: { score: 72, classification: 'SIMILAR' },
      registryL3: 75,
    });
    expect(merged.classification).toBe('SIMILAR');
    expect(merged.score).toBe(80);
  });
});
