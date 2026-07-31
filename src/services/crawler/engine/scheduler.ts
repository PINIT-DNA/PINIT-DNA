/**
 * Crawler scheduler — enqueues platform jobs on configurable interval.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cron = require('node-cron') as typeof import('node-cron');
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { crawlerEngineConfig, isCrawlerEngineEnabled } from './config';
import { crawlerQueue } from './queue';
import { getActiveConnectors } from './connectors';
import type { CrawlerPlatform } from './types';

export class CrawlerScheduler {
  private task: ReturnType<typeof cron.schedule> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private lastScanAt: Date | null = null;
  private nextScanAt: Date | null = null;

  start(onTick: () => Promise<void>): void {
    if (!isCrawlerEngineEnabled()) {
      logger.info('[CrawlerScheduler] Disabled — set CRAWLER_ENGINE_ENABLED=true');
      return;
    }

    const run = async () => {
      this.lastScanAt = new Date();
      this.nextScanAt = new Date(Date.now() + crawlerEngineConfig.scheduleIntervalMinutes * 60_000);
      try {
        await onTick();
      } catch (err) {
        logger.error('[CrawlerScheduler] Tick failed', { error: String(err) });
      }
    };

    if (cron.validate(crawlerEngineConfig.scheduleCron)) {
      this.task = cron.schedule(crawlerEngineConfig.scheduleCron, () => { void run(); });
      logger.info('[CrawlerScheduler] Cron started', { cron: crawlerEngineConfig.scheduleCron });
    } else {
      const ms = crawlerEngineConfig.scheduleIntervalMinutes * 60_000;
      this.intervalTimer = setInterval(() => { void run(); }, ms);
      logger.info('[CrawlerScheduler] Interval started', { minutes: crawlerEngineConfig.scheduleIntervalMinutes });
    }

    void run();
  }

  stop(): void {
    if (this.task) { this.task.stop(); this.task = null; }
    if (this.intervalTimer) { clearInterval(this.intervalTimer); this.intervalTimer = null; }
  }

  getScheduleInfo(): { lastScanAt: string | null; nextScanAt: string | null } {
    return {
      lastScanAt: this.lastScanAt?.toISOString() ?? null,
      nextScanAt: this.nextScanAt?.toISOString() ?? null,
    };
  }

  async enqueueDueMonitors(): Promise<number> {
    const due = await prisma.monitorRecord.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { nextCheckAt: { lte: new Date() } },
          { nextCheckAt: null },
        ],
      },
      take: crawlerEngineConfig.maxJobsPerTick,
      select: { id: true, ownerUserId: true },
    });

    const platforms = getActiveConnectors().map(c => c.platform);
    let enqueued = 0;

    for (const monitor of due) {
      const ids = await crawlerQueue.enqueueForMonitor(
        monitor.id,
        monitor.ownerUserId,
        platforms as CrawlerPlatform[],
      );
      enqueued += ids.length;

      await prisma.monitorRecord.update({
        where: { id: monitor.id },
        data: {
          nextCheckAt: new Date(Date.now() + crawlerEngineConfig.scheduleIntervalMinutes * 60_000),
        },
      });
    }

    logger.info('[CrawlerScheduler] Enqueued jobs', { monitors: due.length, jobs: enqueued });
    return enqueued;
  }
}

export const crawlerScheduler = new CrawlerScheduler();
