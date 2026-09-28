/**
 * Regression: semantic search returned ZERO results for everyone.
 *
 * The service called vectra's queryItems(vector, fetchK), but vectra >= 0.15
 * takes (vector, query, topK, filter) — so topK was undefined and every search
 * silently came back empty. It also fetched a global top-K and filtered by
 * owner afterwards, so other tenants' documents could crowd out a user's own
 * matches. Proves the correct call signature and that owner filtering happens
 * inside the query.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// vectra's nested ESM-only `uuid` cannot be loaded by this Jest setup, so this
// is an in-memory stand-in that reproduces the REAL vectra 0.15 contract,
// measured against the actual library: queryItems(vector, query, topK, filter),
// with cosine similarity, an optional metadata `$in` filter, and — the bug —
// an undefined topK (the old two-argument call) yielding no results at all.
jest.mock('vectra', () => {
  type Item = { id: string; vector: number[]; metadata: Record<string, unknown> };
  const store: { items: Item[] } = { items: [] };
  const cosine = (a: number[], b: number[]) => {
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
    return na && nb ? d / Math.sqrt(na * nb) : 0;
  };
  class LocalIndex {
    static store = store;
    async isIndexCreated() { return true; }
    async createIndex() { /* no-op */ }
    async insertItem(i: { vector: number[]; metadata: Record<string, unknown> }) {
      store.items.push({ id: `id-${store.items.length}-${Math.random()}`, ...i });
    }
    async listItemsByMetadata(f: Record<string, unknown>) {
      return store.items.filter((it) => Object.entries(f).every(([k, v]) => it.metadata[k] === v));
    }
    async deleteItem(id: string) { store.items = store.items.filter((it) => it.id !== id); }
    async getIndexStats() { return { items: store.items.length }; }
    async queryItems(
      vector: number[], _query: string, topK: number,
      filter?: { dnaRecordId?: { $in: string[] } },
    ) {
      if (typeof topK !== 'number') return []; // real 0.15 behaviour for the old call
      let items = store.items;
      const allow = filter?.dnaRecordId?.$in;
      if (allow) items = items.filter((it) => allow.includes(it.metadata['dnaRecordId'] as string));
      return items
        .map((item) => ({ item, score: cosine(vector, item.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }
  }
  return { LocalIndex };
});

import { SemanticSearchService } from '../../src/services/semantic/semantic-search.service';

let svc: SemanticSearchService;

beforeEach(() => {
  (jest.requireMock('vectra') as { LocalIndex: { store: { items: unknown[] } } }).LocalIndex.store.items = [];
  svc = new SemanticSearchService();
});

async function index(id: string, text: string) {
  await svc.indexDocument({ dnaRecordId: id, filename: `${id}.pdf`, fileType: 'PDF', text });
}

describe('SemanticSearchService.search', () => {
  test('returns matching documents (was always empty before the fix)', async () => {
    await index('mine-1', 'quarterly financial report revenue growth');
    const results = await svc.search('financial report', 5, new Set(['mine-1']));
    expect(results.map((r) => r.dnaRecordId)).toEqual(['mine-1']);
    expect(results[0]!.similarity).toBeGreaterThan(0.05);
  });

  test('never returns another owner\'s document', async () => {
    await index('mine-1', 'contract agreement between the parties');
    await index('theirs-1', 'contract agreement between the parties');
    const results = await svc.search('contract agreement', 10, new Set(['mine-1']));
    expect(results.map((r) => r.dnaRecordId)).toEqual(['mine-1']);
  });

  test('other tenants\' near-identical documents cannot push out the caller\'s own hits', async () => {
    // 60 other-tenant documents that match the query far better than the caller's.
    for (let i = 0; i < 60; i++) await index(`theirs-${i}`, 'invoice payment terms net thirty days invoice payment');
    await index('mine-1', 'invoice notes');
    const results = await svc.search('invoice payment terms', 5, new Set(['mine-1']));
    expect(results.map((r) => r.dnaRecordId)).toContain('mine-1');
  });

  test('an empty allow-list yields no results without querying', async () => {
    await index('mine-1', 'anything at all here');
    expect(await svc.search('anything', 5, new Set())).toEqual([]);
  });

  test('respects topK', async () => {
    for (let i = 0; i < 6; i++) await index(`mine-${i}`, 'shared words appear in every document');
    const results = await svc.search('shared words', 3, new Set([0, 1, 2, 3, 4, 5].map((i) => `mine-${i}`)));
    expect(results.length).toBe(3);
  });
});
