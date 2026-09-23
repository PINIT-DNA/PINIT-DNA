/**
 * Item 4.6's logging half: nothing before this persisted layer-by-layer
 * scores server-side anywhere queryable, so there was no real data to check
 * L2/L4 against at production scale. recordLayerScores() is the fix --
 * pinning that it writes real rows, skips cleanly when there's nothing to
 * log, and never lets a write failure escape (it's called fire-and-forget
 * from the investigation orchestrator, which must never fail because of it).
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: { layerScoreObservation: { createMany: jest.fn(async () => ({ count: 0 })) } },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../../src/lib/prisma';
import { logger } from '../../src/lib/logger';
import { recordLayerScores } from '../../src/services/forensics/layer-score-monitoring.service';

const createMany = prisma.layerScoreObservation.createMany as unknown as jest.Mock<AnyAsync>;
const loggerWarn = logger.warn as unknown as jest.Mock<AnyAsync>;

beforeEach(() => {
  createMany.mockReset();
  createMany.mockResolvedValue({ count: 0 });
  loggerWarn.mockReset();
});

describe('recordLayerScores', () => {
  test('writes one row per layer with the real score, converted to 0-1', async () => {
    recordLayerScores({
      investigationId: 'inv-1',
      dnaRecordId: 'dna-1',
      layers: [
        { layer: 2, name: 'Structural', similarityPercent: 87, matched: true },
        { layer: 4, name: 'Semantic', similarityPercent: 62, matched: false },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(createMany).toHaveBeenCalledTimes(1);
    const arg = createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> };
    expect(arg.data).toHaveLength(2);
    expect(arg.data[0]).toMatchObject({
      investigationId: 'inv-1', dnaRecordId: 'dna-1', layer: 2, layerName: 'Structural',
      similarityScore: 0.87, matched: true, skipped: false, context: 'investigation',
    });
    expect(arg.data[1]).toMatchObject({ layer: 4, similarityScore: 0.62, matched: false });
  });

  test('a skipped layer is logged with score 0 and matched:false regardless of its raw percent', async () => {
    recordLayerScores({
      layers: [{ layer: 8, name: 'Relationship', similarityPercent: 100, matched: true, skipped: true }],
    });
    await new Promise((r) => setTimeout(r, 0));

    const arg = createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> };
    expect(arg.data[0]).toMatchObject({ similarityScore: 0, matched: false, skipped: true });
  });

  test('an empty layers array never calls the DB at all', () => {
    recordLayerScores({ layers: [] });
    expect(createMany).not.toHaveBeenCalled();
  });

  test('a DB failure is caught and logged, never thrown', async () => {
    createMany.mockRejectedValue(new Error('db down'));

    expect(() => recordLayerScores({ layers: [{ layer: 1, name: 'Cryptographic', similarityPercent: 100, matched: true }] })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(loggerWarn).toHaveBeenCalledWith(
      '[LayerScoreMonitoring] write failed (non-fatal)',
      expect.objectContaining({ error: expect.stringContaining('db down') }),
    );
  });

  test('context defaults to "investigation" but can be overridden', async () => {
    recordLayerScores({
      layers: [{ layer: 3, name: 'Perceptual', similarityPercent: 90, matched: true }],
      context: 'investigation-partial',
    });
    await new Promise((r) => setTimeout(r, 0));

    const arg = createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> };
    expect(arg.data[0]).toMatchObject({ context: 'investigation-partial' });
  });
});
