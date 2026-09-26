/**
 * Video investigation confidence used to count layers 1-5 TWICE: the blend started from a
 * separate weighted sum of those layers and then added them again from the merged layers.
 * Scores were inflated up to ~2x, and classification is DNA_MATCH >= 95, SIMILAR >= 55,
 * DIFFERENT otherwise — so two videos only ~28% alike on average were labelled SIMILAR and
 * ~48% alike could reach DNA_MATCH. Each layer must contribute its weight exactly once.
 */
import { describe, test, expect, jest } from '@jest/globals';

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { videoOverallConfidence, VIDEO_LAYER_WEIGHTS } from '../../src/services/forensics/video-forensic-compare.service';

const SIMILAR_BAND = 55;
const MATCH_BAND = 95;

const base = { sha256Exact: false, partialRecoveryScore: 0, perceptualScore: 0, matchedFrameRatio: 0 };

/** 15 merged layers, every layer at the same similarity (0..1). */
const uniform = (sim: number) =>
  Array.from({ length: 15 }, (_, i) => ({ layer: i + 1, similarityScore: sim }));

describe('videoOverallConfidence', () => {
  test('a byte-identical video is 100', () => {
    expect(videoOverallConfidence({ ...base, sha256Exact: true }, uniform(0))).toBe(100);
  });

  test('layers 1-5 weigh 1.0 in total, so uniform similarity maps to itself (plus the small layer-6 term)', () => {
    const total = Object.values(VIDEO_LAYER_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 10);
    // 0.40 across the board: 0.40 * (1.00 + 0.05 for layer 6) = 42%, NOT ~84%.
    expect(videoOverallConfidence(base, uniform(0.4))).toBe(42);
  });

  test('regression: ~28% average similarity is DIFFERENT, no longer SIMILAR', () => {
    const overall = videoOverallConfidence(base, uniform(0.28));
    expect(overall).toBe(29);
    expect(overall).toBeLessThan(SIMILAR_BAND);
  });

  test('regression: ~48% average similarity no longer reaches the DNA_MATCH band', () => {
    const overall = videoOverallConfidence(base, uniform(0.48));
    expect(overall).toBe(50);
    expect(overall).toBeLessThan(MATCH_BAND);
    expect(overall).toBeLessThan(SIMILAR_BAND);
  });

  test('a genuinely near-identical video still reaches DNA_MATCH', () => {
    expect(videoOverallConfidence(base, uniform(0.97))).toBeGreaterThanOrEqual(MATCH_BAND);
  });

  test('each layer contributes exactly once at its own weight', () => {
    for (const [layer, weight] of Object.entries(VIDEO_LAYER_WEIGHTS)) {
      const only = [{ layer: Number(layer), similarityScore: 1 }];
      expect(videoOverallConfidence(base, only)).toBe(Math.round(weight * 100));
    }
  });

  test('layers 7-15 (audit / lifecycle data) add nothing', () => {
    const late = Array.from({ length: 9 }, (_, i) => ({ layer: 7 + i, similarityScore: 1 }));
    expect(videoOverallConfidence(base, late)).toBe(0);
  });

  test('the independent recovery signals still act as floors', () => {
    expect(videoOverallConfidence({ ...base, partialRecoveryScore: 80 }, uniform(0.1))).toBe(80);
    expect(videoOverallConfidence({ ...base, perceptualScore: 0.6 }, uniform(0.1))).toBe(60);
    expect(videoOverallConfidence({ ...base, matchedFrameRatio: 0.9 }, uniform(0.1))).toBe(77);
  });

  test('never exceeds 100', () => {
    expect(videoOverallConfidence({ ...base, partialRecoveryScore: 250 }, uniform(1))).toBe(100);
  });
});
