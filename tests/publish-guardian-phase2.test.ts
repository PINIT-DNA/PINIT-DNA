/**
 * Unit tests — Publish Guardian Phase 2 (lifecycle + risk).
 */

import { canTransition, LIFECYCLE, MONITOR_PROFILE } from '../src/services/publish-guardian/lifecycle';
import { evaluateRisk } from '../src/services/publish-guardian/risk-engine';

describe('Publish Guardian lifecycle', () => {
  test('allows PUBLISHING → PROTECTED', () => {
    expect(canTransition(LIFECYCLE.PUBLISHING, LIFECYCLE.PROTECTED)).toBe(true);
  });

  test('blocks ARCHIVED → MONITORING', () => {
    expect(canTransition(LIFECYCLE.ARCHIVED, LIFECYCLE.MONITORING)).toBe(false);
  });

  test('monitor profile constants exist', () => {
    expect(MONITOR_PROFILE.RUNNING).toBe('RUNNING');
    expect(MONITOR_PROFILE.FAILED).toBe('FAILED');
  });
});

describe('Publish Guardian risk engine', () => {
  test('exact match is high/critical', () => {
    const r = evaluateRisk({ similarity: 0.99, matchType: 'DUPLICATE', tampered: false });
    expect(r.score).toBeGreaterThanOrEqual(88);
    expect(['HIGH', 'CRITICAL']).toContain(r.severity);
    expect(r.recommendAlert).toBe(true);
  });

  test('tampered near-match recommends investigation', () => {
    const r = evaluateRisk({ similarity: 0.82, matchType: 'NEAR_MATCH', tampered: true });
    expect(r.recommendInvestigation).toBe(true);
    expect(r.reasons.some((x) => /Tamper/i.test(x))).toBe(true);
  });
});
