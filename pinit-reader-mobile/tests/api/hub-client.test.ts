import { describe, expect, test, vi } from 'vitest';
import { HubClient } from '../../src/api/hub-client';
import { loadProtectedAsset } from '../../src/asset/asset-loader';
import { decideNextStep } from '../../src/asset/open-flow';
import type { ReaderSession, ShareLinkView } from '../../src/core/types';
import { setReaderLogSink } from '../../src/log';

const TOKEN = 'Ab3dEf_g12';
const session: ReaderSession = {
  sessionId: 'session-1',
  appVersion: '0.1.0',
  platform: 'test',
  deviceFingerprint: 'fp_test',
  screenResolution: '800x600',
  timezone: 'UTC',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function activeLink(overrides: Record<string, unknown> = {}) {
  return {
    filename: 'Flower.jpg',
    mimeType: 'image/jpeg',
    isActive: true,
    inactiveReason: null,
    requireOtp: false,
    otpVerified: false,
    requireName: false,
    allowDownload: true,
    requestLocation: false,
    locationAlreadyShared: false,
    viewerRevoked: false,
    ...overrides,
  };
}

const link = activeLink() as ShareLinkView;

describe('hub authorization', () => {
  test('calls fetch as a function', async () => {
    const fetchImpl = vi.fn(async function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return jsonResponse(200, { success: true, link: activeLink() });
    });
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as unknown as typeof fetch);
    const info = await client.getShareInfo(TOKEN, session);
    expect(info.ok).toBe(true);
  });

  test('blocks a revoked share before any asset request', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(String(url));
      return jsonResponse(200, {
        success: true,
        link: activeLink({ isActive: false, inactiveReason: 'revoked' }),
      });
    });
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as unknown as typeof fetch);
    const info = await client.getShareInfo(TOKEN, session);
    expect(info.ok).toBe(false);
    if (info.ok) return;
    expect(info.message).toBe('This share was turned off by the owner.');
    expect(calls.some((url) => url.endsWith('/file'))).toBe(false);
  });

  test('loads an authorized image only after the Hub allows it', async () => {
    setReaderLogSink(() => undefined);
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (String(url).endsWith('/access')) return jsonResponse(200, { success: true });
      if (String(url).endsWith('/file')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      return jsonResponse(200, { success: true, link: activeLink() });
    });
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as unknown as typeof fetch);
    const opened = await loadProtectedAsset(client, TOKEN, session);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.mimeType).toBe('image/jpeg');
    expect(Array.from(opened.bytes)).toEqual([1, 2, 3]);
    expect(calls[0]).toContain(`/share/${TOKEN}`);
    expect(calls[1]).toContain('/access');
    expect(calls[2]).toContain('/file');
  });

  test('asks for location only when the Hub still needs it', () => {
    expect(decideNextStep({ ...link, requestLocation: true }, {})).toEqual({ name: 'location' });
    expect(decideNextStep({ ...link, requestLocation: true, locationAlreadyShared: true }, {})).toEqual({ name: 'load' });
    expect(decideNextStep({ ...link, requireOtp: true }, {})).toEqual({ name: 'otp' });
  });
});
