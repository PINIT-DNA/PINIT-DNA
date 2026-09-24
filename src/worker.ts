/**
 * PINIT-DNA — Background worker process
 *
 * Per the ECS readiness audit §6/§7: the multi-minute/multi-hour work
 * (video/PDF frame protection, Layers 11-15, indexing) currently runs
 * fire-and-forget inside the API process. This is the dedicated worker
 * process entrypoint that consumes queued jobs instead, running as its own
 * ECS service scaled independently from the API tier — active once
 * config.jobs.useQueue is true and vault.service.ts publishes to the queue
 * instead of dispatching in-process (both default false/off; see
 * src/services/vault/vault.service.ts's store() for the two call sites).
 *
 * `video_protect` and `pdf_protect` fetch their input via
 * VaultService.retrieve() rather than closing over an in-memory buffer —
 * no file bytes are put on the queue. This means the queued path re-protects
 * the bytes already sitting in the vault (post identity-embedding), not the
 * pre-embedding raw upload the in-process path uses — see the comment on
 * vault.service.ts's two dispatch sites for why that's the only durable,
 * by-reference source available.
 *
 * `advanced_layers` and `auto_index` are NOT wired into any real dispatch
 * site yet — both fire before a vault record exists (dna.orchestrator.ts and
 * universal-file-router.ts's Layers 11-15 dispatch happen during DNA
 * generation, prior to and independent of vault storage; auto-indexer.
 * service.ts's dispatch is similar), so there is no vaultId/s3Key to
 * reference without either moving when they fire (a real behavior/business
 * logic change, not just wiring) or adding a new raw-bytes staging area.
 * The handler below is a real, tested foundation for the day that's decided,
 * not a currently-reachable production path.
 *
 * Deliberately does not start an HTTP server and does not run node-cron —
 * per the audit, global scheduled jobs belong on a single EventBridge-driven
 * ECS Scheduled Task, not on every replica of any service, workers included.
 */

import { getJobQueue, JobMessage } from './lib/job-queue';
import { VaultService } from './services/vault/vault.service';
import { processAdvancedLayers } from './services/layers/layers-11-15.service';
import { videoPageProtectionService } from './services/videos/video-page-protection.service';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { registerGracefulShutdown } from './lib/graceful-shutdown';

const vaultService = new VaultService();

const POLL_INTERVAL_MS = parseInt(process.env['WORKER_POLL_INTERVAL_MS'] ?? '', 10) || 2_000;
const MAX_MESSAGES_PER_POLL = parseInt(process.env['WORKER_MAX_MESSAGES_PER_POLL'] ?? '', 10) || 5;

let running = true;

async function handleAdvancedLayers(payload: Record<string, unknown>): Promise<void> {
  const { dnaRecordId, vaultId, ownerUserId, mimeType, filename } = payload as {
    dnaRecordId?: string; vaultId?: string; ownerUserId?: string; mimeType?: string; filename?: string;
  };
  if (!dnaRecordId || !vaultId || !ownerUserId || !mimeType) {
    throw new Error('advanced_layers job missing required fields (dnaRecordId, vaultId, ownerUserId, mimeType)');
  }

  const { originalBuffer } = await vaultService.retrieve(vaultId, ownerUserId);
  const result = await processAdvancedLayers(dnaRecordId, originalBuffer, mimeType, ownerUserId, filename ?? '');
  logger.info('[Worker] advanced_layers job complete', { dnaRecordId, ...result });
}

async function handlePdfProtect(payload: Record<string, unknown>): Promise<void> {
  const { vaultId, dnaRecordId, ownerUserId, originalFileName, originalMimeType, certificateId } = payload as {
    vaultId?: string; dnaRecordId?: string; ownerUserId?: string;
    originalFileName?: string; originalMimeType?: string; certificateId?: string | null;
  };
  if (!vaultId || !dnaRecordId || !ownerUserId || !originalFileName || !originalMimeType) {
    throw new Error('pdf_protect job missing required fields (vaultId, dnaRecordId, ownerUserId, originalFileName, originalMimeType)');
  }

  const { originalBuffer } = await vaultService.retrieve(vaultId, ownerUserId);
  await vaultService.upgradePdfInBackground({
    vaultId,
    dnaRecordId,
    ownerUserId,
    rawBuffer: originalBuffer,
    originalFileName,
    originalMimeType,
    certificateId: certificateId ?? null,
  });
  logger.info('[Worker] pdf_protect job complete', { vaultId, dnaRecordId });
}

async function handleVideoProtect(payload: Record<string, unknown>): Promise<void> {
  const { videoDnaRecordId, vaultId, ownerUserId, originalName } = payload as {
    videoDnaRecordId?: string; vaultId?: string; ownerUserId?: string; originalName?: string;
  };
  if (!videoDnaRecordId || !vaultId || !ownerUserId || !originalName) {
    throw new Error('video_protect job missing required fields (videoDnaRecordId, vaultId, ownerUserId, originalName)');
  }

  const { originalBuffer } = await vaultService.retrieve(vaultId, ownerUserId);
  await videoPageProtectionService.protectVideoFrames({
    videoDnaRecordId,
    buffer: originalBuffer,
    originalName,
    ownerUserId,
  });
  logger.info('[Worker] video_protect job complete', { videoDnaRecordId, vaultId });
}

async function dispatch(message: JobMessage): Promise<void> {
  switch (message.type) {
    case 'advanced_layers':
      return handleAdvancedLayers(message.payload);
    case 'pdf_protect':
      return handlePdfProtect(message.payload);
    case 'video_protect':
      return handleVideoProtect(message.payload);
    case 'auto_index':
      // Not yet wired — see this file's header comment.
      throw new Error(`Job type '${message.type}' has no worker handler yet`);
    default:
      throw new Error(`Unknown job type: ${(message as JobMessage).type}`);
  }
}

async function pollOnce(): Promise<number> {
  const queue = getJobQueue();
  const received = await queue.receive(MAX_MESSAGES_PER_POLL);

  for (const { message, receiptHandle } of received) {
    try {
      await dispatch(message);
      await queue.deleteMessage(receiptHandle);
    } catch (err) {
      // No retry/backoff/DLQ logic here by design — a real SQS queue's own
      // redrive policy (maxReceiveCount + a dead-letter queue) should own
      // that, the same way it already does for the one real queue example
      // in this codebase (the crawler engine's CrawlerJob table). Logging
      // and leaving the message unacknowledged is the correct behavior for
      // both backends: SQS will redeliver after its visibility timeout; the
      // local backend simply drops it, which is acceptable since it exists
      // only for local dev/testing, not as a durable queue.
      logger.error('[Worker] Job failed', {
        type: message.type,
        id: message.id,
        attempt: message.attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return received.length;
}

async function loop(): Promise<void> {
  logger.info('[Worker] Started', { pollIntervalMs: POLL_INTERVAL_MS, maxMessagesPerPoll: MAX_MESSAGES_PER_POLL });
  while (running) {
    const count = await pollOnce();
    if (count === 0) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  logger.info('[Worker] Stopped');
}

if (require.main === module) {
  registerGracefulShutdown();
  process.once('SIGTERM', () => { running = false; });
  process.once('SIGINT', () => { running = false; });

  loop()
    .catch((err) => {
      logger.error('[Worker] Fatal error in poll loop', { error: err instanceof Error ? err.message : String(err) });
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}

// Exported for testing — lets a test drive one poll cycle deterministically
// instead of racing the interval-based loop above.
export { pollOnce, dispatch };
