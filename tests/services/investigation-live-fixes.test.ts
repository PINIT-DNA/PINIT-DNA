/**
 * Investigation live-view fixes:
 *  1. a new candidate vault never inherits the previous candidate's name/owner/scores,
 *     and percentages never leave 0-100;
 *  2. a vault original is loaded once per investigation, owner-scoped, evicted on failure.
 */
import { describe, test, expect, jest } from '@jest/globals';
import { mergeSnapshot, clampLiveScores } from '../../src/services/forensics/investigation-live-snapshot';
import { withRetrievalCache, cachedRetrieve } from '../../src/services/vault/investigation-retrieval-cache';

const lead = () => mergeSnapshot(null, {
  phase: 2, signatureFound: true, vaultId: 'v-A', dnaRecordId: 'd-A', ownerName: 'Alice',
  originalFilename: 'The beach.jpg', confidence: 91, dnaMatchPercent: 91,
});

describe('mergeSnapshot', () => {
  test('a different vault does not inherit the previous lead’s filename, owner or scores', () => {
    const next = mergeSnapshot(lead(), { vaultId: 'v-B', confidence: 40 });
    expect(next.vaultId).toBe('v-B');
    expect(next.originalFilename).toBeUndefined();
    expect(next.ownerName).toBeUndefined();
    expect(next.dnaRecordId).toBeUndefined();
    expect(next.confidence).toBe(40);
    expect(next.dnaMatchPercent).toBeUndefined();
  });

  test('the same vault still keeps its earlier details and stronger score', () => {
    const next = mergeSnapshot(lead(), { vaultId: 'v-A', confidence: 10 });
    expect(next.originalFilename).toBe('The beach.jpg');
    expect(next.confidence).toBe(91);
  });

  test('a patch without a vault keeps the lead', () => {
    const next = mergeSnapshot(lead(), { statusMessage: 'working' });
    expect(next.vaultId).toBe('v-A');
    expect(next.originalFilename).toBe('The beach.jpg');
  });

  test('percentages are clamped to 0-100', () => {
    expect(mergeSnapshot(null, { confidence: 120, dnaMatchPercent: 130 }).confidence).toBe(100);
    expect(mergeSnapshot(null, { confidence: 120, dnaMatchPercent: 130 }).dnaMatchPercent).toBe(100);
    expect(clampLiveScores({ confidence: -5 }).confidence).toBe(0);
  });
});

describe('retrieval cache', () => {
  const load = (n = 8) => jest.fn(async () => ({ originalBuffer: Buffer.alloc(n) }));

  test('loads once per user+vault inside a scope, including concurrent asks', async () => {
    const fn = load();
    await withRetrievalCache(async () => {
      await Promise.all([cachedRetrieve('u1', 'v1', fn), cachedRetrieve('u1', 'v1', fn)]);
      await cachedRetrieve('u1', 'v1', fn);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a different user does not get another user’s cached original', async () => {
    const fn = load();
    await withRetrievalCache(async () => {
      await cachedRetrieve('u1', 'v1', fn);
      await cachedRetrieve('u2', 'v1', fn);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('a failed load is evicted and can be retried', async () => {
    const fn = jest.fn<() => Promise<{ originalBuffer: Buffer }>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ originalBuffer: Buffer.alloc(1) });
    await withRetrievalCache(async () => {
      await expect(cachedRetrieve('u1', 'v1', fn)).rejects.toThrow('boom');
      await expect(cachedRetrieve('u1', 'v1', fn)).resolves.toBeDefined();
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('outside a scope nothing is cached, and scopes do not leak', async () => {
    const fn = load();
    await cachedRetrieve('u1', 'v1', fn);
    await cachedRetrieve('u1', 'v1', fn);
    expect(fn).toHaveBeenCalledTimes(2);
    await withRetrievalCache(() => cachedRetrieve('u1', 'v1', fn));
    await withRetrievalCache(() => cachedRetrieve('u1', 'v1', fn));
    expect(fn).toHaveBeenCalledTimes(4);
  });

  test('an oversized original is not retained', async () => {
    const fn = load(33 * 1024 * 1024);
    await withRetrievalCache(async () => {
      await cachedRetrieve('u1', 'big', fn);
      await cachedRetrieve('u1', 'big', fn);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
