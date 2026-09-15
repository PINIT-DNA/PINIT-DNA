/**
 * O4 — a dead share link is an expected end state, not a server fault.
 * O7 — a duplicate refusal must not claim an account it cannot name.
 *
 * Both are message-layer fixes: the mechanics were already correct, the app was
 * telling the user the wrong story about them.
 */
import { describe, test, expect, jest } from '@jest/globals';

jest.mock('../../src/lib/prisma', () => ({ prisma: {} }));
jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { describeUnavailableShare } from '../../src/api/controllers/share-link.controller';
import { buildDuplicateMessage } from '../../src/api/controllers/dna.controller';

describe('O4 — unavailable share responses', () => {
  test('a revoked link is 410 Gone, not a 500 and not a 403', () => {
    const { status, error } = describeUnavailableShare('revoked');
    expect(status).toBe(410);
    expect(error).toBe('This link was turned off by the owner.');
  });

  test('each reason gets its own explanation, never a list of possibilities', () => {
    const reasons = ['expired', 'exhausted', 'one_time', 'revoked'] as const;
    const messages = reasons.map((r) => describeUnavailableShare(r).error);

    expect(new Set(messages).size).toBe(reasons.length);
    for (const m of messages) {
      expect(m).not.toMatch(/inactive, expired, or exhausted/i);
      expect(m).not.toMatch(/internal server error/i);
    }
  });

  test('a tampered token stays 403 — it is a security signal, not an expiry', () => {
    expect(describeUnavailableShare('tampered').status).toBe(403);
  });

  test('every reason returns 403 or 410 — never 5xx', () => {
    const all = ['tampered', 'expired', 'exhausted', 'revoked', 'one_time', null] as const;
    for (const r of all) {
      const { status } = describeUnavailableShare(r);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    }
  });

  test('an unknown reason still gets a usable sentence', () => {
    const { status, error } = describeUnavailableShare(null);
    expect(status).toBe(410);
    expect(error).toBe('This link is no longer available.');
  });
});

describe('O7 — duplicate refusal wording', () => {
  test('names the account when one is known', () => {
    const msg = buildDuplicateMessage('EXACT_HASH', 'PINIT-6QGDDPMF');
    expect(msg).toContain('PINIT-6QGDDPMF');
    expect(msg).toContain('another PINIT account');
  });

  test('does NOT claim another account when none can be named', () => {
    const msg = buildDuplicateMessage('EXACT_HASH', null);
    expect(msg).not.toMatch(/another PINIT account/i);
    expect(msg).toContain('already registered on Pinit');
  });

  test('offers a way forward when no owner is named', () => {
    // Without this the user is refused with no route to resolution.
    expect(buildDuplicateMessage('EXACT_HASH', null)).toMatch(/contact support/i);
  });

  test('the vault-signature case follows the same rule', () => {
    expect(buildDuplicateMessage('PINIT_VAULT_SIGNATURE', null))
      .not.toMatch(/owned by another account/i);
    expect(buildDuplicateMessage('PINIT_VAULT_SIGNATURE', 'PINIT-XYZ'))
      .toContain('PINIT-XYZ');
  });
});
