/**
 * Layer 13's custody chain used to write exactly one FILE_REGISTERED entry
 * at DNA-generation time and never grow. appendCustodyEvent makes it a real,
 * appendable chain.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    custodyLayer: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../../src/lib/prisma';
import { appendCustodyEvent } from '../../src/services/layers/custody-chain.service';

const findUnique = prisma.custodyLayer.findUnique as unknown as jest.Mock<AnyAsync>;
const update = prisma.custodyLayer.update as unknown as jest.Mock<AnyAsync>;

const EXISTING_ENTRY = {
  event: 'FILE_REGISTERED', timestamp: '2026-01-01T00:00:00.000Z',
  actor: 'owner-1', fileHash: 'abc', filename: 'x.jpg',
  dnaRecordId: 'dna-1', evidenceType: 'original-upload', hashAlgorithm: 'SHA-256',
};

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  update.mockResolvedValue({});
});

describe('appendCustodyEvent — the chain actually grows', () => {
  test('appends a new entry onto the existing chain, does not replace it', async () => {
    findUnique.mockResolvedValue({ custodyChain: [EXISTING_ENTRY] });

    await appendCustodyEvent('dna-1', {
      event: 'UNAUTHORIZED_REPRODUCTION_DETECTED',
      actor: 'user-b',
      detail: { matchType: 'NEAR_DUPLICATE_ORB_FEATURES' },
    });

    expect(update).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0]![0] as { where: { dnaRecordId: string }; data: { custodyChain: unknown[] } };
    expect(call.where.dnaRecordId).toBe('dna-1');
    expect(call.data.custodyChain).toHaveLength(2);
    expect(call.data.custodyChain[0]).toEqual(EXISTING_ENTRY); // original entry preserved
    expect((call.data.custodyChain[1] as { event: string }).event).toBe('UNAUTHORIZED_REPRODUCTION_DETECTED');
  });

  test('two appends both survive — the chain keeps growing, not overwriting', async () => {
    findUnique.mockResolvedValueOnce({ custodyChain: [EXISTING_ENTRY] });
    await appendCustodyEvent('dna-1', { event: 'EVENT_TWO' });

    const afterFirst = [EXISTING_ENTRY, { event: 'EVENT_TWO', timestamp: expect.any(String), actor: 'system' }];
    findUnique.mockResolvedValueOnce({ custodyChain: afterFirst });
    await appendCustodyEvent('dna-1', { event: 'EVENT_THREE' });

    const secondCall = update.mock.calls[1]![0] as { data: { custodyChain: unknown[] } };
    expect(secondCall.data.custodyChain).toHaveLength(3);
  });

  test('no Layer 13 row for this record — does nothing, does not throw', async () => {
    findUnique.mockResolvedValue(null);

    await expect(appendCustodyEvent('dna-missing', { event: 'X' })).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  test('a DB failure is swallowed — never throws into the caller', async () => {
    findUnique.mockRejectedValue(new Error('db down'));

    await expect(appendCustodyEvent('dna-1', { event: 'X' })).resolves.toBeUndefined();
  });
});
