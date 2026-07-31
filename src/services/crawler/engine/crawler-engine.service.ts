/**
 * Monitoring & Crawler Engine — main orchestrator.
 *
 * Flow: Scheduler → Queue → Connectors → Download → DNA Compare → Match Pipeline → UEE
 */

import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { crawlerScheduler } from './scheduler';
import { crawlerQueue } from './queue';
import { getActiveConnectors } from './connectors';
import { assetDownloader } from './asset-downloader';
import { dnaComparisonService } from './comparison/dna-comparison.service';
import { matchPipelineService } from './pipeline/match-pipeline.service';
import { isCrawlerEngineEnabled, crawlerEngineConfig } from './config';
import type { CrawlerEngineStats, CrawlerPlatform, ConnectorSearchContext } from './types';

export class CrawlerEngineService {
  private started = false;

  start(): void {
    if (!isCrawlerEngineEnabled() || this.started) return;
    this.started = true;

    crawlerScheduler.start(async () => {
      await crawlerScheduler.enqueueDueMonitors();
    });

    crawlerQueue.startWorkers(async (jobId) => {
      await this.processJob(jobId);
    });

    logger.info('[CrawlerEngine] Started', {
      workers: crawlerEngineConfig.workerCount,
      platforms: getActiveConnectors().map(c => c.platform),
    });
  }

  stop(): void {
    crawlerScheduler.stop();
    crawlerQueue.stopWorkers();
    this.started = false;
    logger.info('[CrawlerEngine] Stopped');
  }

  async processJob(jobId: string): Promise<void> {
    const job = await prisma.crawlerJob.findUnique({
      where: { id: jobId },
      include: {
        monitorRecord: {
          include: {
            dnaRecord: { include: { cryptoLayer: true, ocrRecord: true } },
          },
        },
      },
    });
    if (!job?.monitorRecord) throw new Error(`Job not found: ${jobId}`);

    const monitor = job.monitorRecord;
    const ownerUserId = monitor.ownerUserId;
    if (!ownerUserId) throw new Error('Monitor has no owner');

    const connector = getActiveConnectors().find(c => c.platform === job.platform);
    if (!connector) {
      logger.debug('[CrawlerEngine] Connector not configured', { platform: job.platform });
      return;
    }

    const keywords = this.extractKeywords(
      monitor.dnaRecord.ocrRecord?.extractedText ?? '',
      monitor.filename,
    );

    const ctx: ConnectorSearchContext = {
      monitorRecordId: monitor.id,
      dnaRecordId: monitor.dnaRecordId,
      ownerUserId,
      filename: monitor.filename,
      fileType: monitor.fileType,
      keywords,
      watchUrls: monitor.watchUrls,
      sha256Hash: monitor.dnaRecord.cryptoLayer?.sha256Hash ?? null,
      certificateId: null,
    };

    const searchResult = await connector.search(ctx);
    let matchesFound = 0;

    for (const asset of searchResult.assets) {
      const downloaded = await assetDownloader.download(asset);
      if (!downloaded) continue;

      const comparison = await dnaComparisonService.compareAsset(monitor.dnaRecordId, downloaded);
      if (!dnaComparisonService.exceedsThreshold(comparison)) continue;

      const existing = await prisma.crawlerMatch.findFirst({
        where: {
          monitorRecordId: monitor.id,
          assetUrl: downloaded.assetUrl,
          platform: downloaded.platform,
        },
      });
      if (existing) continue;

      await matchPipelineService.processMatch({
        monitorRecordId: monitor.id,
        dnaRecordId: monitor.dnaRecordId,
        ownerUserId,
        filename: monitor.filename,
        comparison,
        asset: downloaded,
      });
      matchesFound++;
    }

    await prisma.monitorRecord.update({
      where: { id: monitor.id },
      data: {
        lastCheckedAt: new Date(),
        totalChecks: { increment: 1 },
        totalMatches: { increment: matchesFound },
      },
    });

    logger.info('[CrawlerEngine] Job complete', {
      jobId,
      platform: job.platform,
      assets: searchResult.assets.length,
      matchesFound,
      urlsChecked: searchResult.urlsChecked,
    });
  }

  async getEngineStats(ownerUserId?: string): Promise<CrawlerEngineStats> {
    const monitorWhere = ownerUserId ? { ownerUserId } : {};
    const [
      queueStats,
      matchesFound,
      incidentsOpen,
      monitorsActive,
      monitorsTotal,
      lastRun,
    ] = await Promise.all([
      crawlerQueue.getQueueStats(),
      prisma.crawlerMatch.count({ where: ownerUserId ? { ownerUserId } : {} }),
      prisma.incident.count({
        where: { status: 'OPEN', triggerType: 'CRAWLER_MATCH', ...(ownerUserId ? { dnaRecordId: { in: await this.ownerDnaIds(ownerUserId) } } : {}) },
      }),
      prisma.monitorRecord.count({ where: { ...monitorWhere, status: 'ACTIVE' } }),
      prisma.monitorRecord.count({ where: monitorWhere }),
      prisma.monitoringRun.findFirst({
        where: ownerUserId ? { monitorRecord: { ownerUserId } } : {},
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      }),
    ]);

    const schedule = crawlerScheduler.getScheduleInfo();
    const total = queueStats.completed24h + queueStats.failed24h;
    const successRate = total > 0 ? Math.round((queueStats.completed24h / total) * 100) : 100;

    const connectors = getActiveConnectors();
    const platformsConnected = {
      WEBSITE: connectors.some(c => c.platform === 'WEBSITE'),
      GITHUB: connectors.some(c => c.platform === 'GITHUB'),
      YOUTUBE: connectors.some(c => c.platform === 'YOUTUBE'),
      REDDIT: connectors.some(c => c.platform === 'REDDIT'),
      TELEGRAM: connectors.some(c => c.platform === 'TELEGRAM'),
      BING: false,
      GOOGLE: false,
    } satisfies Record<CrawlerPlatform, boolean>;

    return {
      crawlerStatus: isCrawlerEngineEnabled() ? (queueStats.running > 0 ? 'RUNNING' : 'IDLE') : 'DISABLED',
      platformsConnected,
      jobsPending: queueStats.pending,
      jobsRunning: queueStats.running,
      jobsCompleted24h: queueStats.completed24h,
      jobsFailed24h: queueStats.failed24h,
      matchesFound,
      incidentsOpen,
      lastScanAt: schedule.lastScanAt ?? lastRun?.startedAt?.toISOString() ?? null,
      nextScanAt: schedule.nextScanAt,
      successRate,
      coverage: {
        monitorsActive,
        monitorsTotal,
        platformsEnabled: connectors.length,
      },
    };
  }

  private async ownerDnaIds(ownerUserId: string): Promise<string[]> {
    const records = await prisma.dnaRecord.findMany({
      where: { ownerUserId },
      select: { id: true },
    });
    return records.map(r => r.id);
  }

  private extractKeywords(text: string, filename: string): string[] {
    const words = new Map<string, number>();
    for (const w of text.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
      words.set(w, (words.get(w) ?? 0) + 1);
    }
    for (const w of filename.toLowerCase().replace(/\.[^.]+$/, '').split(/[_\-\s\.]/)) {
      if (w.length > 3) words.set(w, (words.get(w) ?? 0) + 5);
    }
    const stop = new Set(['that', 'this', 'with', 'from', 'have', 'been']);
    return [...words.entries()]
      .filter(([w]) => !stop.has(w))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([w]) => w);
  }
}

export const crawlerEngineService = new CrawlerEngineService();
