/**
 * The AI service keeps its search index on an ephemeral local disk and restarts
 * independently of the backend. syncAiIndex() indexes whatever the database has
 * that the AI service does not — all of it, not "the first 200".
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const findMany = jest.fn<AnyAsync>();
jest.mock('../../src/lib/prisma', () => ({ prisma: { dnaRecord: { findMany } } }));
jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const isOnline = jest.fn<AnyAsync>();
const getIndexedIds = jest.fn<AnyAsync>();
const indexDocument = jest.fn<AnyAsync>();
jest.mock('../../src/services/ai/ai-embeddings.service', () => ({
  aiService: { isOnline, getIndexedIds, indexDocument },
}));

import { syncAiIndex, buildIndexText } from '../../src/services/ai/ai-index-sync.service';

const row = (id: string, ocr?: string) => ({
  id, imageFilename: `${id}.pdf`, fileType: 'PDF', ocrRecord: ocr ? { extractedText: ocr } : null,
});

/** First findMany call lists ids; later calls fetch the pages to index. */
function seedDb(ids: string[], rows: ReturnType<typeof row>[]) {
  findMany.mockImplementation(async (args: unknown) => {
    const a = args as { where?: { id?: { in: string[] } } };
    if (a.where?.id?.in) return rows.filter((r) => a.where!.id!.in.includes(r.id));
    return ids.map((id) => ({ id }));
  });
}

beforeEach(() => {
  findMany.mockReset(); isOnline.mockReset(); getIndexedIds.mockReset(); indexDocument.mockReset();
  isOnline.mockResolvedValue(true);
  indexDocument.mockResolvedValue({ success: true });
});

describe('syncAiIndex', () => {
  test('does nothing while the AI service is offline', async () => {
    isOnline.mockResolvedValue(false);
    expect(await syncAiIndex()).toEqual({ status: 'offline' });
    expect(indexDocument).not.toHaveBeenCalled();
  });

  test('an unreadable index is "unknown", never treated as empty (no mass re-index)', async () => {
    getIndexedIds.mockResolvedValue(null);
    expect(await syncAiIndex()).toEqual({ status: 'unknown-index' });
    expect(indexDocument).not.toHaveBeenCalled();
  });

  test('in sync -> no indexing', async () => {
    getIndexedIds.mockResolvedValue(new Set(['a', 'b']));
    seedDb(['a', 'b'], []);
    expect(await syncAiIndex()).toEqual({ status: 'in-sync', total: 2 });
    expect(indexDocument).not.toHaveBeenCalled();
  });

  test('indexes ONLY the missing documents', async () => {
    getIndexedIds.mockResolvedValue(new Set(['a']));
    seedDb(['a', 'b', 'c'], [row('a'), row('b'), row('c')]);
    const r = await syncAiIndex();
    expect(r).toMatchObject({ status: 'synced', missing: 2, indexed: 2, failed: 0 });
    const ids = indexDocument.mock.calls.map((c) => (c[0] as { dnaRecordId: string }).dnaRecordId).sort();
    expect(ids).toEqual(['b', 'c']);
  });

  test('a wiped AI index with more than 200 records is fully rebuilt (the old code stopped at 200)', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `doc-${i}`);
    getIndexedIds.mockResolvedValue(new Set());
    seedDb(ids, ids.map((id) => row(id)));
    const r = await syncAiIndex();
    expect(r).toMatchObject({ status: 'synced', missing: 450, indexed: 450 });
    expect(indexDocument).toHaveBeenCalledTimes(450);
  });

  test('counts failures without aborting the run', async () => {
    getIndexedIds.mockResolvedValue(new Set());
    seedDb(['a', 'b'], [row('a'), row('b')]);
    indexDocument.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ success: true });
    expect(await syncAiIndex()).toMatchObject({ status: 'synced', indexed: 1, failed: 1 });
  });

  test('is single-flight: an overlapping call reports busy', async () => {
    getIndexedIds.mockResolvedValue(new Set());
    seedDb(['a'], [row('a')]);
    let release!: () => void;
    indexDocument.mockImplementationOnce(() => new Promise((res) => { release = () => res({ success: true }); }));
    const first = syncAiIndex();
    await new Promise((r) => setImmediate(r));
    expect(await syncAiIndex()).toEqual({ status: 'busy' });
    release();
    await first;
  });
});

describe('buildIndexText', () => {
  test('uses OCR text when there is enough of it, else a cleaned filename', () => {
    expect(buildIndexText('Report.pdf', 'x'.repeat(60))).toContain('Report.pdf');
    expect(buildIndexText('Q3_budget-plan.pdf', 'short')).toBe('Q3 budget plan');
  });
});
