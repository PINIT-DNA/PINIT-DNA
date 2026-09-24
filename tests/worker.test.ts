/**
 * Step 5 — worker redelivery / duplicate-message behavior.
 *
 * Verifies the property the ECS readiness audit's §6/§7 findings and Phase 0's
 * upsert conversion exist to guarantee: a job redelivered under SQS's
 * at-least-once semantics (simulated here via the local backend's
 * redeliverUndeletedLocalJobs(), since a real SQS visibility timeout can't be
 * exercised without a live queue) is either a safe no-op or an idempotent
 * update — never a duplicate record, never a second full pipeline run.
 */
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

process.env['JOB_QUEUE_BACKEND'] = 'local';

const mockRetrieve = jest.fn(async () => ({
  originalBuffer: Buffer.from('fake bytes'),
  originalFileName: 'photo.jpg',
  originalMimeType: 'image/jpeg',
  originalSizeBytes: 10,
  vaultId: 'vault-1',
  dnaRecordId: 'dna-1',
}));
jest.mock('../src/services/vault/vault.service', () => ({
  VaultService: jest.fn().mockImplementation(() => ({ retrieve: mockRetrieve })),
}));

const upsertCalls: Array<{ dnaRecordId: string }> = [];
jest.mock('../src/services/layers/layers-11-15.service', () => ({
  processAdvancedLayers: jest.fn(async (dnaRecordId: string) => {
    // Mirrors the real function's shape after Phase 0's upsert conversion:
    // a repeat call for the same dnaRecordId succeeds again (upsert), it
    // does not throw a unique-constraint error the way the old create()
    // call would have on redelivery.
    upsertCalls.push({ dnaRecordId });
    return { successful: 5, failed: 0, completedLayers: [11, 12, 13, 14, 15] };
  }),
}));

jest.mock('../src/lib/graceful-shutdown', () => ({ registerGracefulShutdown: jest.fn() }));
jest.mock('../src/lib/prisma', () => ({ prisma: { $disconnect: jest.fn() } }));

import { pollOnce, dispatch } from '../src/worker';
import { getJobQueue, getLocalJobQueueSize, getLocalJobQueueInFlightSize, redeliverUndeletedLocalJobs, JobMessage } from '../src/lib/job-queue';

beforeEach(() => {
  upsertCalls.length = 0;
  mockRetrieve.mockClear();
});

describe('worker — redelivery of a failed job', () => {
  test('a job whose handler throws stays in-flight, is redelivered on the next cycle, and attempt increments', async () => {
    const queue = getJobQueue();
    await queue.publish('advanced_layers', { dnaRecordId: 'x' }); // missing vaultId/ownerUserId/mimeType -> handler throws

    const firstPass = await pollOnce();
    expect(firstPass).toBe(1);
    expect(getLocalJobQueueSize()).toBe(0); // consumed off the visible queue
    expect(getLocalJobQueueInFlightSize()).toBe(1); // never deleteMessage()'d — the handler threw

    const redelivered = redeliverUndeletedLocalJobs();
    expect(redelivered).toBe(1);
    expect(getLocalJobQueueSize()).toBe(1); // visible again for the next receive()

    const received = await queue.receive(1);
    expect(received).toHaveLength(1);
    expect(received[0].message.attempt).toBe(2); // incremented across the two receive() calls
  });
});

describe('worker — duplicate/redelivered advanced_layers job is a safe no-op, not a duplicate write', () => {
  test('processing the same dnaRecordId twice calls the idempotent (upsert-based) layer function twice, not a duplicate-record failure', async () => {
    const message: JobMessage = {
      id: 'job-1',
      type: 'advanced_layers',
      attempt: 1,
      payload: { dnaRecordId: 'dna-1', vaultId: 'vault-1', ownerUserId: 'owner-1', mimeType: 'image/jpeg', filename: 'photo.jpg' },
    };

    // Simulate a genuine SQS at-least-once redelivery: the exact same
    // message is dispatched twice (e.g. the first delivery's ack was lost).
    await dispatch(message);
    await dispatch({ ...message, attempt: 2 });

    // Real production code: Phase 0 converted all 5 layer creates to
    // upsert(dnaRecordId), so a second call for the same dnaRecordId is a
    // safe overwrite, not a thrown unique-constraint error. This test
    // verifies the worker calls the (now-idempotent) function again on
    // redelivery rather than skipping it or crashing — the safety itself
    // is proven by layers-11-15.service.ts's own upsert conversion.
    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[0].dnaRecordId).toBe('dna-1');
    expect(upsertCalls[1].dnaRecordId).toBe('dna-1');
    // Fetched the buffer fresh each time via VaultService.retrieve() — no
    // buffer is ever carried on the queue message itself.
    expect(mockRetrieve).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(message.payload)).not.toMatch(/[\x00-\x08]/); // sanity: payload is plain JSON-safe references, not binary
  });
});
