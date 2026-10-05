import type { ReaderSession } from '../core/types';

export const READER_VERSION = '0.1.0';
const SESSION_KEY = 'pinit_reader_session';

export interface SessionStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const memory = new Map<string, string>();

const memoryStore: SessionStore = {
  get: (key) => memory.get(key) ?? null,
  set: (key, value) => { memory.set(key, value); },
};

function browserStore(): SessionStore | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return {
      get: (key) => sessionStorage.getItem(key),
      set: (key, value) => sessionStorage.setItem(key, value),
    };
  } catch {
    return null;
  }
}

function newSessionId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Same style of browser signature the Hub viewer already sends. Not a person identifier. */
export function deviceFingerprint(): string {
  try {
    if (typeof document === 'undefined') return 'fp_reader';
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    let canvasSig = '';
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#1f4b3a';
      ctx.fillRect(0, 0, 200, 40);
      ctx.fillStyle = '#fff';
      ctx.fillText(`PINIT-READER-${navigator.userAgent.slice(0, 20)}`, 2, 2);
      canvasSig = canvas.toDataURL();
    }
    const raw = [
      navigator.userAgent,
      navigator.language,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      String(navigator.hardwareConcurrency ?? ''),
      canvasSig,
    ].join('|');
    let h = 0;
    for (let i = 0; i < raw.length; i += 1) {
      h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
    }
    return `fp_${(h >>> 0).toString(16)}_${raw.length.toString(16)}`;
  } catch {
    return 'fp_reader';
  }
}

export function createSessionContext(store: SessionStore = browserStore() ?? memoryStore): ReaderSession {
  let sessionId = store.get(SESSION_KEY);
  if (!sessionId) {
    sessionId = newSessionId();
    store.set(SESSION_KEY, sessionId);
  }
  const platform = typeof navigator !== 'undefined' ? navigator.platform || 'unknown' : 'unknown';
  let screenResolution = '';
  let timezone = 'UTC';
  try {
    if (typeof screen !== 'undefined') screenResolution = `${screen.width}x${screen.height}`;
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    timezone = 'UTC';
  }
  return {
    sessionId,
    appVersion: READER_VERSION,
    platform,
    deviceFingerprint: deviceFingerprint(),
    screenResolution,
    timezone,
  };
}

/** Headers the existing public share routes already accept. */
export function sessionHeaders(session: ReaderSession): Record<string, string> {
  return {
    'x-pinit-session': session.sessionId,
    'x-pinit-fingerprint': session.deviceFingerprint,
  };
}
