/**
 * Two paths in leaked-file-verify.service.ts (the watermark-extraction path
 * and _checkPHashMatch) used to hardcode `tampered: true` for every hit,
 * even though a real perceptual similarity score was already computed right
 * there — a 99%-similar match (ordinary recompression from a normal
 * reshare, e.g. WhatsApp/Instagram re-encoding) got flagged identically to
 * a genuinely edited copy. Both now derive `tampered` from the actual
 * number via this one shared, pure function — pinning the real decision
 * boundary here, no DB/image mocking needed since the function takes a
 * plain similarity score.
 */
import { describe, test, expect } from '@jest/globals';
import { deriveTamperFromSimilarity } from '../../src/services/forensics/leaked-file-verify.service';

describe('deriveTamperFromSimilarity', () => {
  test('a near-perfect match (ordinary recompression) is NOT flagged tampered', () => {
    const r = deriveTamperFromSimilarity(0.99);
    expect(r.tampered).toBe(false);
    expect(r.note).toMatch(/consistent with ordinary recompression/i);
  });

  test('exactly at the clear threshold is NOT tampered (>= is the clear side)', () => {
    const r = deriveTamperFromSimilarity(0.95);
    expect(r.tampered).toBe(false);
  });

  test('just below the clear threshold IS tampered', () => {
    const r = deriveTamperFromSimilarity(0.9499);
    expect(r.tampered).toBe(true);
    expect(r.note).toMatch(/beyond ordinary recompression/i);
  });

  test('a borderline match just above the raw leak-detection floor is tampered', () => {
    // 0.88 is PHASH_LEAK_THRESHOLD -- the bar to be considered a match at
    // all -- well below the 0.95 "clearly not tampered" bar.
    const r = deriveTamperFromSimilarity(0.88);
    expect(r.tampered).toBe(true);
  });

  test('a perfect match (1.0) is never tampered', () => {
    expect(deriveTamperFromSimilarity(1.0).tampered).toBe(false);
  });

  test('a low match (would not even reach this function in practice) is tampered', () => {
    expect(deriveTamperFromSimilarity(0.5).tampered).toBe(true);
  });
});
