import { describe, expect, test, vi } from 'vitest';
import { HubClient } from '../../src/api/hub-client';
import { loadProtectedAsset } from '../../src/reader/asset-loader';
import type { ReaderSession } from '../../src/core/types';
import { setReaderLogSink } from '../../src/log';

const TOKEN = 'Ab3dEf_g12';
const HOP = 'Zz9xYw_v8u';
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
    filename: 'Vaibhavi.jpg',
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

describe('hub client', () => {
  test('calls fetch as a function so the browser accepts it', async () => {
    const fetchImpl = vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return jsonResponse(200, { success: true, link: activeLink() });
    });
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as typeof fetch);
    const info = await client.getShareInfo(TOKEN, session);
    expect(info.ok).toBe(true);
  });

  test('loads an authorized asset and records one VIEWED event', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (String(url).endsWith('/access')) {
        const body = JSON.parse(String(init?.body));
        expect(body.action).toBe('VIEWED');
        expect(body.sessionId).toBe('session-1');
        expect(body.deviceFingerprint).toBe('fp_test');
        expect((init?.headers as Record<string, string>)['x-pinit-session']).toBe('session-1');
        return jsonResponse(200, { success: true });
      }
      if (String(url).endsWith('/file')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      return jsonResponse(200, { success: true, link: activeLink() });
    });
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as typeof fetch);
    const opened = await loadProtectedAsset(client, TOKEN, session);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.mimeType).toBe('image/jpeg');
    expect(calls).toEqual([
      `GET http://hub.test/api/v1/share/${TOKEN}`,
      `POST http://hub.test/api/v1/share/${TOKEN}/access`,
      `GET http://hub.test/api/v1/share/${TOKEN}/file`,
    ]);
  });

  test('reports an expired share without requesting the file', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      success: true,
      link: activeLink({ isActive: false, inactiveReason: 'expired' }),
    }));
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as typeof fetch);
    const opened = await loadProtectedAsset(client, TOKEN, session);
    expect(opened).toMatchObject({ ok: false, kind: 'expired', message: 'This share has expired.' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('reports a revoked share', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      success: true,
      link: activeLink({ isActive: false, inactiveReason: 'revoked' }),
    }));
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as typeof fetch);
    const opened = await loadProtectedAsset(client, TOKEN, session);
    expect(opened).toMatchObject({ ok: false, kind: 'revoked' });
  });

  test('reports unauthorized access', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/access')) {
        return jsonResponse(403, { success: false, viewerRevoked: true, error: 'Your access to this link has been revoked by the owner' });
      }
      return jsonResponse(200, { success: true, link: activeLink() });
    });
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as typeof fetch);
    const opened = await loadProtectedAsset(client, TOKEN, session);
    expect(opened).toMatchObject({ ok: false, kind: 'revoked' });
  });

  test('reports a device restriction', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/access')) {
        return jsonResponse(403, { success: false, reason: 'BLOCKED_DEVICE', error: 'mobile devices are not permitted' });
      }
      return jsonResponse(200, { success: true, link: activeLink() });
    });
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as typeof fetch);
    const opened = await loadProtectedAsset(client, TOKEN, session);
    expect(opened).toMatchObject({ ok: false, kind: 'device_restricted' });
  });

  test('reports a download restriction from the file response', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/file')) {
        return jsonResponse(403, { success: false, error: 'Maximum downloads reached for this link' });
      }
      if (String(url).endsWith('/access')) return jsonResponse(200, { success: true });
      return jsonResponse(200, { success: true, link: activeLink() });
    });
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as typeof fetch);
    const opened = await loadProtectedAsset(client, TOKEN, session);
    expect(opened).toMatchObject({ ok: false, kind: 'download_restricted' });
  });

  test('reports a network failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('offline'); });
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as typeof fetch);
    const opened = await loadProtectedAsset(client, TOKEN, session);
    expect(opened).toMatchObject({ ok: false, kind: 'network' });
  });

  test('reports the Hub as unavailable', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { success: false, code: 'BACKEND_OFFLINE' }));
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as typeof fetch);
    const opened = await loadProtectedAsset(client, TOKEN, session);
    expect(opened).toMatchObject({ ok: false, kind: 'hub_unavailable' });
  });

  test('follows one forwarding hop, then loads that share', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith(`/${TOKEN}/access`)) return jsonResponse(200, { success: true, redirectToken: HOP });
      if (href.endsWith(`/${HOP}/access`)) return jsonResponse(200, { success: true });
      if (href.endsWith(`/${HOP}/file`)) {
        return new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      if (href.endsWith(`/share/${HOP}`)) return jsonResponse(200, { success: true, link: activeLink() });
      if (init?.method === 'POST') return jsonResponse(200, { success: true });
      return jsonResponse(200, { success: true, link: activeLink() });
    });
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as typeof fetch);
    const opened = await loadProtectedAsset(client, TOKEN, session);
    expect(opened.ok).toBe(true);
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.endsWith(`/share/${HOP}/file`))).toBe(true);
    expect(urls.filter((url) => url.endsWith('/file'))).toHaveLength(1);
  });

  test('does not write the share token into progress logs', async () => {
    const lines: string[] = [];
    setReaderLogSink((line) => lines.push(line));
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/file')) {
        return new Response('x', { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      if (String(url).endsWith('/access')) return jsonResponse(200, { success: true });
      return jsonResponse(200, { success: true, link: activeLink() });
    });
    const client = new HubClient('http://hub.test/api/v1', fetchImpl as typeof fetch);
    await loadProtectedAsset(client, TOKEN, session);
    setReaderLogSink(null);
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.join('\n')).toContain('Connecting to Hub...');
    expect(lines.join('\n')).toContain('Loading protected asset...');
  });
});
