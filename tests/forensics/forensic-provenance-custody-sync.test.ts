/**
 * Layer 13 (CustodyLayer.custodyChain) and ForensicProvenanceEvent used to be
 * two disconnected systems: Layer 13 only grew on blocked-duplicate events,
 * while investigation reports read exclusively from ForensicProvenanceEvent
 * — so Layer 13 never reflected what an investigation actually showed. This
 * pins the reconciliation: every forensicProvenanceService.append() now also
 * mirrors into Layer 13 via appendCustodyEvent(), from one central write.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    forensicProvenanceEvent: { findUnique: jest.fn(async () => null), create: jest.fn() },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/layers/custody-chain.service', () => ({
  appendCustodyEvent: jest.fn(async () => undefined),
}));

import { prisma } from '../../src/lib/prisma';
import { forensicProvenanceService } from '../../src/services/forensics/forensic-provenance.service';
import { appendCustodyEvent } from '../../src/services/layers/custody-chain.service';

const create = prisma.forensicProvenanceEvent.create as unknown as jest.Mock<AnyAsync>;
const findUnique = prisma.forensicProvenanceEvent.findUnique as unknown as jest.Mock<AnyAsync>;
const custodyAppend = appendCustodyEvent as unknown as jest.Mock<AnyAsync>;

beforeEach(() => {
  create.mockReset();
  findUnique.mockReset();
  findUnique.mockResolvedValue(null);
  custodyAppend.mockReset();
  custodyAppend.mockResolvedValue(undefined);
});

describe('forensicProvenanceService.append() mirrors into Layer 13', () => {
  test('a normal append with a dnaRecordId also calls appendCustodyEvent', async () => {
    create.mockResolvedValue({ id: 'prov-1' });

    await forensicProvenanceService.append({
      eventType: 'INVESTIGATED',
      summary: 'Investigation run',
      dnaRecordId: 'dna-1',
      actorLabel: 'investigator-1',
    });

    expect(custodyAppend).toHaveBeenCalledWith(
      'dna-1',
      expect.objectContaining({
        event: 'INVESTIGATED',
        actor: 'investigator-1',
        detail: expect.objectContaining({ summary: 'Investigation run', provenanceEventId: 'prov-1' }),
      }),
    );
  });

  test('an append with no dnaRecordId never calls appendCustodyEvent — nothing to mirror to', async () => {
    create.mockResolvedValue({ id: 'prov-2' });

    await forensicProvenanceService.append({
      eventType: 'SHARED',
      summary: 'Share link opened',
      vaultId: 'vault-only-no-dna-record',
    });

    expect(custodyAppend).not.toHaveBeenCalled();
  });

  test('a Layer 13 mirror failure never fails the primary provenance write', async () => {
    create.mockResolvedValue({ id: 'prov-3' });
    custodyAppend.mockRejectedValue(new Error('custody write down'));

    const id = await forensicProvenanceService.append({
      eventType: 'TAMPERED',
      summary: 'Tamper detected',
      dnaRecordId: 'dna-2',
    });

    expect(id).toBe('prov-3');
  });

  test('actorUserId is used as the custody actor when no actorLabel is given', async () => {
    create.mockResolvedValue({ id: 'prov-4' });

    await forensicProvenanceService.append({
      eventType: 'DOWNLOADED',
      summary: 'File downloaded',
      dnaRecordId: 'dna-3',
      actorUserId: 'user-abc',
    });

    expect(custodyAppend).toHaveBeenCalledWith('dna-3', expect.objectContaining({ actor: 'user-abc' }));
  });

  test('falls back to "system" as the custody actor when neither actorLabel nor actorUserId is given', async () => {
    create.mockResolvedValue({ id: 'prov-5' });

    await forensicProvenanceService.append({
      eventType: 'CRAWLER_DETECTION',
      summary: 'Crawler found a leak',
      dnaRecordId: 'dna-4',
    });

    expect(custodyAppend).toHaveBeenCalledWith('dna-4', expect.objectContaining({ actor: 'system' }));
  });
});
