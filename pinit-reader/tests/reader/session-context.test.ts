import { describe, expect, test } from 'vitest';
import { createSessionContext, sessionHeaders, type SessionStore } from '../../src/tracking/session-context';

describe('reader session', () => {
  test('keeps one session id and sends the headers the Hub already accepts', () => {
    const saved = new Map<string, string>();
    const store: SessionStore = {
      get: (key) => saved.get(key) ?? null,
      set: (key, value) => { saved.set(key, value); },
    };
    const first = createSessionContext(store);
    const second = createSessionContext(store);
    expect(second.sessionId).toBe(first.sessionId);
    expect(first.appVersion).toBe('0.1.0');
    expect(first.deviceFingerprint.length).toBeGreaterThan(0);
    expect(sessionHeaders(first)).toEqual({
      'x-pinit-session': first.sessionId,
      'x-pinit-fingerprint': first.deviceFingerprint,
    });
  });
});
