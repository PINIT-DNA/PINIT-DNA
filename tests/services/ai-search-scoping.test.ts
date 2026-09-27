/**
 * POST /ai/search must hand the AI service the caller's document ids so the
 * owner filter runs inside the search; filtering only afterwards let other
 * tenants' documents fill the top-K.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
const post = jest.fn<AnyAsync>();
jest.mock('axios', () => {
  const inst = { get: jest.fn(), put: jest.fn(), post: jest.fn(), interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } };
  return { __esModule: true, default: { get: jest.fn(), put: jest.fn(), post, create: jest.fn(() => inst) } };
});
jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/lib/prisma', () => ({ prisma: {} }));
jest.mock('../../src/services/audit/audit.service', () => ({ auditService: { log: jest.fn() } }));
jest.mock('../../src/lib/tenant-scope', () => ({
  getAuthUserId: () => 'user-a',
  ownedDnaIdSet: async () => new Set(['mine-1', 'mine-2']),
  filterByOwnedDna: (hits: Array<{ dnaRecordId?: string }>, owned: Set<string>) =>
    hits.filter((h) => h.dnaRecordId && owned.has(h.dnaRecordId)),
}));

import { semanticSearch } from '../../src/api/controllers/ai.controller';

const run = async (body: Record<string, unknown>) => {
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })) } as never;
  await semanticSearch({ body } as never, res, jest.fn());
  return json.mock.calls[0]![0] as { results: Array<{ dnaRecordId: string }> };
};

beforeEach(() => { post.mockReset(); });

describe('semanticSearch scoping', () => {
  test.each([['hybrid'], ['semantic']])('%s mode sends the owners ids to the AI service', async (mode) => {
    post.mockResolvedValue({ data: { results: [{ dnaRecordId: 'mine-1' }, { dnaRecordId: 'theirs-9' }] } });
    const out = await run({ query: 'invoice', mode });
    const sent = post.mock.calls[0]![1] as { allowedIds: string[] };
    expect([...sent.allowedIds].sort()).toEqual(['mine-1', 'mine-2']);
    expect(out.results.map((r) => r.dnaRecordId)).toEqual(['mine-1']); // defence in depth still applies
  });
});
