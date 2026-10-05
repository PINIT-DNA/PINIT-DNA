import type { ReaderSession } from '../core/types';

export const READER_VERSION = '0.1.0';
export const SESSION_KEY = 'pinit_reader_session';

export function newSessionId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A stable device signature for the Hub. Not a person identifier. */
export function deviceFingerprint(source: string): string {
  let h = 0;
  for (let i = 0; i < source.length; i += 1) {
    h = (Math.imul(31, h) + source.charCodeAt(i)) | 0;
  }
  return `fp_${(h >>> 0).toString(16)}_${source.length.toString(16)}`;
}

export function buildReaderSession(input: {
  sessionId: string;
  platform: string;
  screenResolution: string;
  timezone: string;
  fingerprintSource: string;
}): ReaderSession {
  return {
    sessionId: input.sessionId,
    appVersion: READER_VERSION,
    platform: input.platform,
    deviceFingerprint: deviceFingerprint(input.fingerprintSource),
    screenResolution: input.screenResolution,
    timezone: input.timezone || 'UTC',
  };
}

/** Headers the existing public share routes already accept. */
export function sessionHeaders(session: ReaderSession): Record<string, string> {
  return {
    'x-pinit-session': session.sessionId,
    'x-pinit-fingerprint': session.deviceFingerprint,
  };
}
