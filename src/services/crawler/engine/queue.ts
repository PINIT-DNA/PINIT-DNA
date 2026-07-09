/**
 * Persistent crawler job queue with in-process workers.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { crawlerEngineConfig } from './config';
import type { CrawlerJobStatus, CrawlerPlatform } from './types';

export interface EnqueueJobInput {
  monitorRecordId: string;
  ownerUserId: string | null;
  platform: CrawlerPlatform;
  priority?: number;
  payload?: Record<string, unknown>;
  scheduledAt?: Date;
}

export class CrawlerQueue {
  private processing = false;
  private workerTimer: ReturnType<typeof setInterval> | null = null;

  async enqueue(input: EnqueueJobInput): Promise<string> {
    const existing = await prisma.crawlerJob.findFirst({
      where: {
        monitorRecordId: input.monitorRecordId,
        platform: input.platform,
        status: { in: ['PENDING', 'RUNNING'] },
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    const job = await prisma.crawlerJob.create({
      data: {
        monitorRecordId: input.monitorRecordId,
        ownerUserId: input.ownerUserId,
        platform: input.platform,
        status: 'PENDING',
        priority: input.priority ?? 0,
        maxAttempts: crawlerEngineConfig.maxAttempts,
        scheduledAt: input.scheduledAt ?? new Date(),
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    logger.debug('[CrawlerQueue] Job enqueued', { jobId: job.id, platform: input.platform });
    return job.id;
  }

  async enqueueForMonitor(
    monitorRecordId: string,
    ownerUserId: string | null,
    platforms: CrawlerPlatform[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const platform of platforms) {
      ids.push(await this.enqueue({ monitorRecordId, ownerUserId, platform }));
    }
    return ids;
  }

  startWorkers(processJob: (jobId: string) => Promise<void>): void {
    if (this.workerTimer) return;
    const tick = async () => {
      if (this.processing) return;
      this.processing = true;
      try {
        const jobs = await prisma.crawlerJob.findMany({
          where: {
            status: 'PENDING',
            scheduledAt: { lte: new Date() },
            attempts: { lt: crawlerEngineConfig.maxAttempts },
          },
          orderBy: [{ priority: 'desc' }, { scheduledAt: 'asc' }],
          take: crawlerEngineConfig.workerCount,
        });

        await Promise.all(jobs.map(async (job) => {
          const claimed = await prisma.crawlerJob.updateMany({
            where: { id: job.id, status: 'PENDING' },
            data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
          });
          if (claimed.count === 0) return;

          const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Job timeout')), crawlerEngineConfig.jobTimeoutMs);
          });

          try {
            await Promise.race([processJob(job.id), timeout]);
            await prisma.crawlerJob.update({
              where: { id: job.id },
              data: { status: 'COMPLETED', completedAt: new Date(), error: null },
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const failed = job.attempts + 1 >= job.maxAttempts;
            await prisma.crawlerJob.update({
              where: { id: job.id },
              data: {
                status: failed ? 'FAILED' : 'PENDING',
                error: msg.slice(0, 500),
                completedAt: failed ? new Date() : null,
                scheduledAt: failed ? job.scheduledAt : new Date(Date.now() + crawlerEngineConfig.retryDelayMs),
              },
            });
            logger.warn('[CrawlerQueue] Job failed', { jobId: job.id, platform: job.platform, error: msg });
          }
        }));
      } finally {
        this.processing = false;
      }
    };

    this.workerTimer = setInterval(() => { void tick(); }, 5000);
    void tick();
    logger.info('[CrawlerQueue] Workers started', { workers: crawlerEngineConfig.workerCount });
  }

  stopWorkers(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  }

  async getQueueStats(): Promise<{
    pending: number;
    running: number;
    completed24h: number;
    failed24h: number;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [pending, running, completed24h, failed24h] = await Promise.all([
      prisma.crawlerJob.count({ where: { status: 'PENDING' } }),
      prisma.crawlerJob.count({ where: { status: 'RUNNING' } }),
      prisma.crawlerJob.count({ where: { status: 'COMPLETED', completedAt: { gte: since } } }),
      prisma.crawlerJob.count({ where: { status: 'FAILED', completedAt: { gte: since } } }),
    ]);
    return { pending, running, completed24h, failed24h };
  }

  async markStatus(jobId: string, status: CrawlerJobStatus, error?: string): Promise<void> {
    await prisma.crawlerJob.update({
      where: { id: jobId },
      data: {
        status,
        error: error?.slice(0, 500) ?? null,
        completedAt: status === 'COMPLETED' || status === 'FAILED' ? new Date() : undefined,
      },
    });
  }
}

export const crawlerQueue = new CrawlerQueue();
