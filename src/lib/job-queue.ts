/**
 * PINIT-DNA — Background job queue abstraction
 *
 * Per the ECS readiness audit §6/§7: today, video/PDF frame protection,
 * Layers 11-15, and indexing all run as in-process `void`-dispatched
 * fire-and-forget work inside the API process, with no persisted job state —
 * a crash mid-job is a silent, permanent, partial loss. This module is the
 * queue-side foundation for moving that work to a dedicated ECS worker
 * service consuming SQS, without committing to it before there is a real
 * queue to test against.
 *
 * Two backends behind one interface:
 *   - 'local'  — an in-process, in-memory queue. NOT durable, NOT shared
 *                across processes — it exists so the worker dispatch logic
 *                in src/worker.ts can be genuinely exercised and verified
 *                locally, the same way local dev already defaults to local
 *                disk for vault storage before Supabase/S3 is configured.
 *   - 'sqs'    — a real Amazon SQS queue. Requires JOB_QUEUE_URL and AWS
 *                credentials; cannot be exercised without a real queue, so
 *                it is implemented but not exercised as part of Phase 0.
 *
 * Selected via JOB_QUEUE_BACKEND, defaulting to 'local' — this module is not
 * wired into any existing fire-and-forget call site yet (see src/worker.ts's
 * header comment for why), so choosing either backend today has no effect
 * on current production behavior.
 */

import { randomUUID } from 'crypto';
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { logger } from './logger';

export type JobType = 'video_protect' | 'pdf_protect' | 'advanced_layers' | 'auto_index';

export interface JobMessage {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  /** Incremented by the consumer on each receive; queues redeliver at-least-once. */
  attempt: number;
}

export interface ReceivedJob {
  message: JobMessage;
  /** Opaque handle the backend needs to acknowledge/delete this specific delivery. */
  receiptHandle: string;
}

export interface JobQueueClient {
  publish(type: JobType, payload: Record<string, unknown>): Promise<void>;
  receive(maxMessages?: number): Promise<ReceivedJob[]>;
  deleteMessage(receiptHandle: string): Promise<void>;
}

// ─── Local, in-memory backend (Phase 0 — genuinely testable, not durable) ──

class LocalJobQueue implements JobQueueClient {
  private queue: ReceivedJob[] = [];
  // Received-but-not-yet-deleted messages — models SQS's "in-flight, hidden
  // until deleteMessage() or visibility timeout" state, so deleteMessage()
  // is a real, meaningful step here too, not a no-op. Without this, nothing
  // in this codebase could actually exercise/test at-least-once redelivery
  // behavior against the queue abstraction itself.
  private inFlight = new Map<string, ReceivedJob>();

  async publish(type: JobType, payload: Record<string, unknown>): Promise<void> {
    const message: JobMessage = { id: randomUUID(), type, payload, attempt: 0 };
    this.queue.push({ message, receiptHandle: randomUUID() });
    logger.debug('[JobQueue:local] Published', { type, id: message.id });
  }

  async receive(maxMessages = 1): Promise<ReceivedJob[]> {
    const batch = this.queue.splice(0, maxMessages);
    for (const item of batch) {
      item.message.attempt += 1;
      this.inFlight.set(item.receiptHandle, item);
    }
    return batch;
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    this.inFlight.delete(receiptHandle);
  }

  /**
   * Test-only: simulates what SQS does automatically after a visibility
   * timeout elapses on an undeleted message — makes every still-in-flight
   * (i.e. never deleteMessage()'d, meaning the consumer never finished
   * successfully) message visible again for a future receive(), with its
   * attempt count already incremented from the failed delivery. Not part of
   * the JobQueueClient interface; call it explicitly in a test to model
   * "the consumer crashed/threw and the message needs to be redelivered."
   */
  redeliverUndeleted(): number {
    const redelivered = [...this.inFlight.values()];
    this.inFlight.clear();
    this.queue.push(...redelivered);
    return redelivered.length;
  }

  /** Test/inspection helper — not part of the JobQueueClient interface. */
  size(): number {
    return this.queue.length;
  }

  /** Test/inspection helper — not part of the JobQueueClient interface. */
  inFlightSize(): number {
    return this.inFlight.size;
  }
}

// ─── SQS backend (Phase 1+ — not exercised without a real queue) ──────────

class SqsJobQueue implements JobQueueClient {
  private client: SQSClient | null = null;

  private getClient(): SQSClient {
    if (!this.client) {
      const region = process.env['AWS_REGION']?.trim() || 'ap-south-1';
      this.client = new SQSClient({ region });
    }
    return this.client;
  }

  private getQueueUrl(): string {
    const url = process.env['JOB_QUEUE_URL']?.trim();
    if (!url) throw new Error('JOB_QUEUE_URL must be set to use the sqs job queue backend');
    return url;
  }

  async publish(type: JobType, payload: Record<string, unknown>): Promise<void> {
    const message: Omit<JobMessage, 'attempt'> = { id: randomUUID(), type, payload };
    await this.getClient().send(new SendMessageCommand({
      QueueUrl: this.getQueueUrl(),
      MessageBody: JSON.stringify(message),
    }));
    logger.debug('[JobQueue:sqs] Published', { type, id: message.id });
  }

  async receive(maxMessages = 1): Promise<ReceivedJob[]> {
    const result = await this.getClient().send(new ReceiveMessageCommand({
      QueueUrl: this.getQueueUrl(),
      MaxNumberOfMessages: Math.min(Math.max(maxMessages, 1), 10),
      WaitTimeSeconds: 10,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }));

    const messages = result.Messages ?? [];
    return messages
      .filter((m) => m.Body && m.ReceiptHandle)
      .map((m) => {
        const parsed = JSON.parse(m.Body!) as Omit<JobMessage, 'attempt'>;
        const attempt = Number(m.Attributes?.['ApproximateReceiveCount'] ?? '1');
        return { message: { ...parsed, attempt }, receiptHandle: m.ReceiptHandle! };
      });
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    await this.getClient().send(new DeleteMessageCommand({
      QueueUrl: this.getQueueUrl(),
      ReceiptHandle: receiptHandle,
    }));
  }
}

// ─── Backend selection ──────────────────────────────────────────────────────

let _client: JobQueueClient | null = null;
let _localQueueForTests: LocalJobQueue | null = null;

export function getJobQueue(): JobQueueClient {
  if (_client) return _client;

  const backend = (process.env['JOB_QUEUE_BACKEND'] ?? 'local').trim();
  if (backend === 'sqs') {
    _client = new SqsJobQueue();
    logger.info('[JobQueue] Using SQS backend');
  } else {
    const local = new LocalJobQueue();
    _localQueueForTests = local;
    _client = local;
    logger.info('[JobQueue] Using local in-memory backend (not durable, not shared across processes)');
  }
  return _client;
}

/** Test/diagnostic helper only — throws if the local backend isn't active. */
export function getLocalJobQueueSize(): number {
  if (!_localQueueForTests) throw new Error('Local job queue backend is not active');
  return _localQueueForTests.size();
}

/** Test/diagnostic helper only — throws if the local backend isn't active. */
export function getLocalJobQueueInFlightSize(): number {
  if (!_localQueueForTests) throw new Error('Local job queue backend is not active');
  return _localQueueForTests.inFlightSize();
}

/**
 * Test-only: simulates an SQS visibility-timeout redelivery — every message
 * received but never deleteMessage()'d (i.e. the consumer never finished
 * successfully) becomes visible again for the next receive(), with attempt
 * already incremented. Throws if the local backend isn't active.
 */
export function redeliverUndeletedLocalJobs(): number {
  if (!_localQueueForTests) throw new Error('Local job queue backend is not active');
  return _localQueueForTests.redeliverUndeleted();
}
