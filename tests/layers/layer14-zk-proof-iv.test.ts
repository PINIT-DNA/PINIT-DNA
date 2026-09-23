/**
 * Layer 14's proof-data encryption used a FIXED all-zero AES-GCM IV with a
 * key derived deterministically from ownerUserId — meaning every file the
 * same owner ever protected reused the same (key, IV) pair. That's AES-GCM's
 * "forbidden attack" setup: repeated nonce use lets an attacker recover the
 * XOR of plaintexts across a user's files, and with enough samples, forge
 * auth tags. Fixed to a random IV per call, stored alongside the ciphertext.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import crypto from 'crypto';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: { zkProofLayer: { create: jest.fn(async () => ({})) } },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../../src/lib/prisma';
import { processLayer14 } from '../../src/services/layers/layers-11-15.service';

const zkCreate = prisma.zkProofLayer.create as unknown as jest.Mock<AnyAsync>;

beforeEach(() => {
  zkCreate.mockReset();
  zkCreate.mockResolvedValue({});
});

function proofDataOf(call: unknown): string {
  return (call as { data: { proofData: string } }).data.proofData;
}

describe('Layer 14 — proof data encryption', () => {
  test('the IV differs across two calls for the SAME owner (the actual bug)', async () => {
    const owner = 'owner-fixed-iv-regression';
    await processLayer14('dna-1', Buffer.from('file one'), owner);
    await processLayer14('dna-2', Buffer.from('file two'), owner);

    const [iv1] = proofDataOf(zkCreate.mock.calls[0]![0]).split(':');
    const [iv2] = proofDataOf(zkCreate.mock.calls[1]![0]).split(':');

    expect(iv1).toHaveLength(24); // 12 bytes hex-encoded
    expect(iv1).not.toBe('000000000000000000000000'.slice(0, 24)); // not the old fixed zero IV
    expect(iv1).not.toBe(iv2); // different every call — the fix
  });

  test('proofData is iv:ciphertext:authTag and actually decrypts with that IV', async () => {
    const owner = 'owner-roundtrip-check';
    await processLayer14('dna-3', Buffer.from('some file bytes'), owner);

    const proofData = proofDataOf(zkCreate.mock.calls[0]![0]);
    const parts = proofData.split(':');
    expect(parts).toHaveLength(3);
    const [ivHex, cipherHex, tagHex] = parts as [string, string, string];

    const key = crypto.createHash('sha256').update(owner).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]);
    // The secret is a 32-byte random value hex-encoded (64 hex chars) — just
    // confirm it decrypts to something of the right shape, not the exact
    // value (that's randomly generated per call, by design).
    expect(decrypted.toString('utf8')).toMatch(/^[0-9a-f]{64}$/);
  });
});
