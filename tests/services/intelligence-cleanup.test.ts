/**
 * Intelligence-module cleanup:
 *  - Tika "unavailable" is only cached briefly (a sidecar that starts later must be picked up)
 *  - the public Tika health response no longer reveals the internal URL
 *  - Tika extraction reports 503 instead of a misleading empty 200 when Tika is down
 *  - search text is never written to the audit log (length only)
 *  - the leftover /intelligence/debug/indexed route is gone
 */
import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const axiosGet = jest.fn<AnyAsync>();
jest.mock('axios', () => {
  const inst = { get: axiosGet, put: jest.fn(), post: jest.fn(), interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } };
  return { __esModule: true, default: { get: axiosGet, put: jest.fn(), post: jest.fn(), create: jest.fn(() => inst) } };
});
// Heavy import chains that these controllers/routes pull in but the tests never exercise.
jest.mock('../../src/services/vault/vault.service', () => ({ VaultService: jest.fn(() => ({})) }));
jest.mock('../../src/lib/prisma', () => ({ prisma: {} }));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const auditLog = jest.fn<AnyAsync>();
jest.mock('../../src/services/audit/audit.service', () => ({
  auditService: { log: auditLog },
}));
const searchFn = jest.fn<AnyAsync>();
jest.mock('../../src/services/semantic/semantic-search.service', () => ({
  SemanticSearchService: jest.fn(() => ({ search: searchFn, getIndexSize: jest.fn() })),
}));
jest.mock('../../src/lib/tenant-scope', () => ({
  getAuthUserId: () => 'user-a',
  ownedDnaIdSet: async () => new Set(['d1']),
}));

import { TikaService } from '../../src/services/tika/tika.service';

describe('TikaService availability caching', () => {
  let now = 1_000_000;
  beforeEach(() => {
    axiosGet.mockReset();
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => { jest.restoreAllMocks(); });

  test('unavailable is cached briefly, then rechecked — a late-starting Tika is picked up', async () => {
    const t = new TikaService();
    axiosGet.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await t.isAvailable()).toBe(false);
    expect(await t.isAvailable()).toBe(false);
    expect(axiosGet).toHaveBeenCalledTimes(1); // second call served from the short cache

    axiosGet.mockResolvedValue({ status: 200 });
    now += 61_000; // past the 60s recheck window
    expect(await t.isAvailable()).toBe(true);
    expect(axiosGet).toHaveBeenCalledTimes(2);
  });

  test('once available it stays cached (no per-request probing)', async () => {
    const t = new TikaService();
    axiosGet.mockResolvedValue({ status: 200 });
    expect(await t.isAvailable()).toBe(true);
    now += 10 * 60_000;
    expect(await t.isAvailable()).toBe(true);
    expect(axiosGet).toHaveBeenCalledTimes(1);
  });
});

describe('Tika controller', () => {
  test('health response does not reveal the internal Tika URL', async () => {
    process.env['TIKA_URL'] = 'http://internal-tika.private:9998';
    axiosGet.mockRejectedValue(new Error('down'));
    const { tikaHealth } = await import('../../src/api/controllers/tika.controller');
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as never;
    await tikaHealth({} as never, res, jest.fn());
    const body = JSON.stringify(json.mock.calls[0]![0]);
    expect(body).not.toContain('internal-tika');
    expect(body).not.toContain('9998');
    delete process.env['TIKA_URL'];
  });
});

describe('search audit', () => {
  test('the semantic-search audit event stores query length, never the query text', async () => {
    auditLog.mockReset();
    searchFn.mockResolvedValue([]);
    const { semanticSearch } = await import('../../src/api/controllers/document-intelligence.controller');
    const res = { status: jest.fn(() => ({ json: jest.fn() })) } as never;
    await semanticSearch({ query: { q: 'my confidential merger plan' } } as never, res, jest.fn());
    expect(auditLog).toHaveBeenCalledTimes(1);
    const entry = auditLog.mock.calls[0]![0] as { eventType: string; detail: Record<string, unknown> };
    expect(entry.eventType).toBe('SEMANTIC_SEARCH');
    expect(JSON.stringify(entry.detail)).not.toContain('merger');
    expect(entry.detail['queryLength']).toBe('my confidential merger plan'.length);
  });
});

describe('leftover debug route', () => {
  test('/intelligence/debug/indexed is no longer registered', async () => {
    const { intelligenceRouter } = await import('../../src/api/routes/intelligence.routes');
    const paths = (intelligenceRouter as unknown as { stack: Array<{ route?: { path: string } }> }).stack
      .map((l) => l.route?.path).filter(Boolean);
    expect(paths).not.toContain('/debug/indexed');
    expect(paths).toContain('/search'); // sanity: the router itself still loads
  });
});
