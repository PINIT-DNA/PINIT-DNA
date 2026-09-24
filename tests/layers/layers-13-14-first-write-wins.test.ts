/**
 * Layers 13 and 14 under at-least-once job redelivery.
 *
 * Layers 11/12/15 are recomputed from the same inputs, so an upsert that
 * overwrites on a repeat delivery is harmless. Layers 13 and 14 are not:
 *  - Layer 13 stores the legal registration timestamp + evidence hash — a later
 *    redelivery must not move "when this file was first registered".
 *  - Layer 14 generates a fresh random secret per call — a later redelivery
 *    must not replace the original commitment with an unrelated one.
 * Both therefore upsert with an EMPTY update (first write wins).
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    custodyLayer: { upsert: jest.fn(async () => ({})) },
    zkProofLayer: { upsert: jest.fn(async () => ({})) },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../../src/lib/prisma';
import { processLayer13, processLayer14 } from '../../src/services/layers/layers-11-15.service';

const custodyUpsert = prisma.custodyLayer.upsert as unknown as jest.Mock<AnyAsync>;
const zkUpsert = prisma.zkProofLayer.upsert as unknown as jest.Mock<AnyAsync>;

type UpsertArgs = {
  where: { dnaRecordId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

beforeEach(() => {
  custodyUpsert.mockReset();
  zkUpsert.mockReset();
  custodyUpsert.mockResolvedValue({});
  zkUpsert.mockResolvedValue({});
});

describe('Layer 13 — custody chain is first-write-wins', () => {
  test('keyed on dnaRecordId, creates the full record, and never overwrites an existing one', async () => {
    const ok = await processLayer13('dna-1', Buffer.from('bytes'), 'owner-1', 'a.jpg');
    expect(ok).toBe(true);

    const args = custodyUpsert.mock.calls[0]![0] as UpsertArgs;
    expect(args.where).toEqual({ dnaRecordId: 'dna-1' });
    expect(args.create['dnaRecordId']).toBe('dna-1');
    expect(args.create['legalTimestamp']).toBeInstanceOf(Date);
    expect(typeof args.create['evidenceHash']).toBe('string');
    expect(args.update).toEqual({});
  });

  test('a redelivered job still succeeds (no unique-constraint failure) and again carries an empty update', async () => {
    await processLayer13('dna-1', Buffer.from('bytes'), 'owner-1', 'a.jpg');
    const second = await processLayer13('dna-1', Buffer.from('bytes'), 'owner-1', 'a.jpg');

    expect(second).toBe(true);
    expect(custodyUpsert).toHaveBeenCalledTimes(2);
    expect((custodyUpsert.mock.calls[1]![0] as UpsertArgs).update).toEqual({});
  });
});

describe('Layer 14 — ZK commitment is first-write-wins', () => {
  test('keyed on dnaRecordId, creates the full record, and never overwrites an existing one', async () => {
    const ok = await processLayer14('dna-1', Buffer.from('bytes'), 'owner-1');
    expect(ok).toBe(true);

    const args = zkUpsert.mock.calls[0]![0] as UpsertArgs;
    expect(args.where).toEqual({ dnaRecordId: 'dna-1' });
    expect(typeof args.create['commitmentHash']).toBe('string');
    expect(args.update).toEqual({});
  });

  test('two deliveries generate different random secrets, so overwriting would have changed the commitment', async () => {
    await processLayer14('dna-1', Buffer.from('bytes'), 'owner-1');
    await processLayer14('dna-1', Buffer.from('bytes'), 'owner-1');

    const first = zkUpsert.mock.calls[0]![0] as UpsertArgs;
    const second = zkUpsert.mock.calls[1]![0] as UpsertArgs;
    // This is the reason the empty update matters: the two payloads genuinely differ.
    expect(first.create['commitmentHash']).not.toBe(second.create['commitmentHash']);
    expect(first.update).toEqual({});
    expect(second.update).toEqual({});
  });
});
