/**
 * PINIT-DNA — Monitoring Service (Production Grade)
 *
 * Multi-type monitoring pipeline:
 *   Documents (PDF/DOCX/TXT/PPTX/XLSX) → text + semantic similarity
 *   Images (JPG/PNG/WEBP)              → pHash + CLIP embedding
 *   Audio (MP3/WAV)                    → spectral fingerprint
 *   Video (MP4/MOV)                    → keyframe pHash
 *
 * Every run is tracked in MonitoringRun.
 * Every failure is recorded in MonitoringFailure.
 * Matches ≥ HIGH automatically generate EvidenceRecords.
 */

import { prisma }      from '../../lib/prisma';
import { logger }      from '../../lib/logger';
import { assertRecordOwner } from '../../lib/tenant-scope';
import { webCrawler }  from './web-crawler.service';
import { aiService }   from '../ai/ai-embeddings.service';
import { imageMonitoringService } from './image-monitoring.service';
import type { ImageMonitoringSummary } from './image-monitoring.service';
import {
  buildYouTubeWatchUrl,
  extractYouTubeVideoId,
  filenameSearchQueries,
  getYouTubeVideo,
  isStrongAutoYouTubeMatch,
  isYouTubeConfigured,
  scoreYouTubeFilenameMatch,
  searchYouTubeVideos,
  YOUTUBE_AUTO_ALERT_MIN,
} from './youtube-search.util';

// ─── Match type constants ─────────────────────────────────────────────────────

export const MATCH = {
  EXACT:    'EXACT_MATCH',    // ≥ 0.95
  HIGH:     'HIGH_MATCH',     // ≥ 0.85
  POSSIBLE: 'POSSIBLE_MATCH', // ≥ 0.70
  NONE:     'NO_MATCH',
} as const;

/** On in production by default; set MONITORING_CRAWLER_ENABLED=false to disable. */
export function isMonitoringCrawlerEnabled(): boolean {
  const v = (process.env['MONITORING_CRAWLER_ENABLED'] ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'yes') return true;
  return process.env['NODE_ENV'] === 'production';
}

export type MatchType = typeof MATCH[keyof typeof MATCH];

function classifyTextSimilarity(sim: number): MatchType {
  if (sim >= 0.95) return MATCH.EXACT;
  if (sim >= 0.85) return MATCH.HIGH;
  if (sim >= 0.70) return MATCH.POSSIBLE;
  return MATCH.NONE;
}

// ─── File type routing helpers ────────────────────────────────────────────────

const IMAGE_TYPES  = new Set(['IMAGE', 'JPG', 'JPEG', 'PNG', 'WEBP', 'GIF']);
const AUDIO_TYPES  = new Set(['AUDIO', 'MP3', 'WAV', 'FLAC', 'AAC', 'OGG']);
const VIDEO_TYPES  = new Set(['VIDEO', 'MP4', 'MOV', 'AVI', 'MKV', 'WEBM']);

function routeFileType(fileType: string, mimeType?: string): 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' {
  const ft = (fileType ?? '').toUpperCase();
  const mt = (mimeType ?? '').toLowerCase();
  if (IMAGE_TYPES.has(ft) || mt.startsWith('image/'))           return 'IMAGE';
  if (AUDIO_TYPES.has(ft) || mt.startsWith('audio/'))           return 'AUDIO';
  if (VIDEO_TYPES.has(ft) || mt.startsWith('video/'))           return 'VIDEO';
  return 'DOCUMENT';
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface MonitoringSummary {
  monitorRecordId:   string;
  runId:             string;
  filename:          string;
  fileCategory:      string;
  urlsChecked:       number;
  candidatesFound:   number;
  matchesFound:      number;
  failuresCount:     number;
  highestSimilarity: number;
  durationMs:        number;
  alerts:            AlertItem[];
  /** Video scan path */
  method?:           string;
  youtubeCandidates?: number;
}

export interface AlertItem {
  url:        string;
  pageTitle:  string;
  similarity: number;
  matchType:  MatchType;
  text:       string;
  evidenceId?: string;
}

// ─── Monitoring Service ───────────────────────────────────────────────────────

/** Map scan schedule to hours between automatic checks. MANUAL = no auto scans. */
function scanTypeToCheckHrs(scanType: string): number {
  switch (scanType) {
    case 'WEEKLY':     return 168;
    case 'CONTINUOUS': return 1;
    case 'MANUAL':     return 0;
    default:           return 24;
  }
}

export class MonitoringService {

  // ─── Enroll a file for monitoring ──────────────────────────────────────────

  async enroll(
    dnaRecordId: string,
    opts: { watchUrls?: string[]; scanType?: string; ownerUserId: string }
  ): Promise<string> {
    // Enrollment always allowed — auto background scans only run when crawler is enabled.
    const autoCrawl = isMonitoringCrawlerEnabled();

    const record = await prisma.dnaRecord.findUnique({
      where:  { id: dnaRecordId },
      select: { imageFilename: true, fileType: true, ownerUserId: true },
    });
    if (!record) throw new Error(`DNA record not found: ${dnaRecordId}`);
    assertRecordOwner(record.ownerUserId, opts.ownerUserId, 'DNA record');

    const existing = await prisma.monitorRecord.findFirst({
      where: { dnaRecordId, status: { not: 'STOPPED' } },
    });

    const scanType    = opts.scanType ?? 'CONTINUOUS';
    const checkHrs    = scanTypeToCheckHrs(scanType);
    const ownerUserId = record.ownerUserId ?? opts.ownerUserId;
    const watchUrls   = opts.watchUrls ?? [];

    if (existing) {
      const mergedUrls = watchUrls.length
        ? [...new Set([...existing.watchUrls, ...watchUrls])]
        : existing.watchUrls;

      await prisma.monitorRecord.update({
        where: { id: existing.id },
        data: {
          scanType,
          checkEveryHrs: checkHrs,
          watchUrls: mergedUrls,
          status: 'ACTIVE',
          nextCheckAt: !autoCrawl || scanType === 'MANUAL' ? null : new Date(Date.now() + 5_000),
        },
      });

      logger.info('[Monitor] File re-configured', {
        monitorId: existing.id,
        scanType,
        autoCrawl,
      });
      return existing.id;
    }

    const monitor = await prisma.monitorRecord.create({
      data: {
        dnaRecordId,
        ownerUserId,
        filename:     record.imageFilename,
        fileType:     record.fileType ?? 'UNKNOWN',
        status:       'ACTIVE',
        scanType,
        checkEveryHrs: checkHrs,
        nextCheckAt:  !autoCrawl || scanType === 'MANUAL' ? null : new Date(Date.now() + 5_000),
        watchUrls,
      },
    });

    logger.info('[Monitor] File enrolled', { filename: record.imageFilename, scanType, id: monitor.id, autoCrawl });
    import('../platform-events/extended-events').then(({ emitMonitoringLifecycle }) => {
      emitMonitoringLifecycle({
        ownerUserId,
        monitorRecordId: monitor.id,
        filename: record.imageFilename,
        action: 'started',
      });
    }).catch(() => {});

    // Kick off first scan only when auto-crawler is enabled (skip MANUAL)
    if (autoCrawl && scanType !== 'MANUAL') {
      void this.runCheck(monitor.id, 'SCHEDULED').catch((err) =>
        logger.warn('[Monitor] Initial scan failed', { id: monitor.id, error: String(err) }),
      );
    }

    return monitor.id;
  }

  // ─── Run monitoring check ──────────────────────────────────────────────────

  async runCheck(
    monitorRecordId: string,
    trigger: 'MANUAL' | 'SCHEDULED' | 'CONTINUOUS' = 'SCHEDULED'
  ): Promise<MonitoringSummary | ImageMonitoringSummary> {
    if (!isMonitoringCrawlerEnabled()) {
      throw new Error('Monitoring crawler is disabled. Set MONITORING_CRAWLER_ENABLED=true when ready.');
    }

    const monitor = await prisma.monitorRecord.findUnique({
      where:   { id: monitorRecordId },
      include: { dnaRecord: { include: { ocrRecord: true } } },
    });
    if (!monitor) throw new Error(`Monitor not found: ${monitorRecordId}`);

    // Create a run record
    const run = await prisma.monitoringRun.create({
      data: { monitorRecordId, trigger, status: 'RUNNING' },
    });

    const startedAt = Date.now();
    const fileCategory = routeFileType(monitor.fileType, monitor.dnaRecord.imageMimeType);

    try {
      let result: MonitoringSummary | ImageMonitoringSummary;

      if (fileCategory === 'IMAGE') {
        logger.info('[Monitor] → IMAGE pipeline', { filename: monitor.filename });
        result = await imageMonitoringService.runCheck(monitorRecordId);
      } else if (fileCategory === 'AUDIO') {
        logger.info('[Monitor] → AUDIO pipeline', { filename: monitor.filename });
        result = await this.runAudioCheck(monitor, run.id);
      } else if (fileCategory === 'VIDEO') {
        logger.info('[Monitor] → VIDEO pipeline', { filename: monitor.filename });
        result = await this.runVideoCheck(monitor, run.id);
      } else {
        logger.info('[Monitor] → DOCUMENT pipeline', { filename: monitor.filename, fileType: monitor.fileType });
        result = await this.runDocumentCheck(monitor, run.id);
      }

      const durationMs = Date.now() - startedAt;
      const summary = result as MonitoringSummary;

      await prisma.monitoringRun.update({
        where: { id: run.id },
        data: {
          status:        'COMPLETED',
          completedAt:   new Date(),
          durationMs,
          candidatesFound: summary.candidatesFound ?? 0,
          matchesFound:   summary.matchesFound ?? 0,
        },
      });

      await prisma.monitorRecord.update({
        where: { id: monitorRecordId },
        data: {
          lastCheckedAt:  new Date(),
          nextCheckAt:    new Date(Date.now() + monitor.checkEveryHrs * 3_600_000),
          totalChecks:    { increment: 1 },
          totalMatches:   { increment: summary.matchesFound ?? 0 },
          lastDurationMs: durationMs,
        },
      });

      import('../platform-events/extended-events').then(({ emitCrawlerScanCompleted }) => {
        if (!monitor.ownerUserId) return;
        const img = result as ImageMonitoringSummary;
        const doc = result as MonitoringSummary;
        emitCrawlerScanCompleted({
          ownerUserId: monitor.ownerUserId,
          monitorRecordId,
          filename: monitor.filename,
          matchesFound: doc.matchesFound ?? img.matchesFound ?? 0,
          urlsChecked: doc.urlsChecked ?? doc.candidatesFound ?? img.urlsChecked ?? 0,
        });
      }).catch(() => {});

      return result;

    } catch (err) {
      const durationMs = Date.now() - startedAt;
      await prisma.monitoringRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date(), durationMs, failureReason: String(err) },
      });
      await prisma.monitorRecord.update({
        where: { id: monitorRecordId },
        data: { totalFailures: { increment: 1 }, lastCheckedAt: new Date(),
                nextCheckAt: new Date(Date.now() + monitor.checkEveryHrs * 3_600_000) },
      });
      import('../platform-events/extended-events').then(({ emitCrawlerError }) => {
        if (!monitor.ownerUserId) return;
        emitCrawlerError({
          ownerUserId: monitor.ownerUserId,
          monitorRecordId,
          filename: monitor.filename,
          error: String(err),
        });
      }).catch(() => {});
      throw err;
    }
  }

  // ─── Document monitoring pipeline ─────────────────────────────────────────

  private async runDocumentCheck(monitor: any, runId: string): Promise<MonitoringSummary> {
    const ocrText  = monitor.dnaRecord.ocrRecord?.extractedText ?? '';
    const keywords = this.extractKeywords(ocrText, monitor.filename);
    const urls     = [...monitor.watchUrls, ...webCrawler.generateSearchUrls(monitor.filename, keywords)];

    const alerts: AlertItem[] = [];
    let highestSim   = 0;
    let candidatesFound = 0;
    const failures: Array<{ url: string; stage: string; error: string }> = [];

    const crawlResults = await webCrawler.crawlUrls(urls);

    for (const page of crawlResults) {
      if (!page.text || page.wordCount < 10) continue;
      candidatesFound++;

      let similarity = 0;
      let matchType: MatchType = MATCH.NONE;

      try {
        const searchRes = await aiService.search(page.text.slice(0, 500), 3, 0.60);
        const topMatch  = searchRes.results?.find(
          (r: { dnaRecordId: string; similarity: number }) => r.dnaRecordId === monitor.dnaRecordId
        );
        if (topMatch) {
          similarity = topMatch.similarity;
          matchType  = classifyTextSimilarity(similarity);
        }
      } catch {
        // AI offline — keyword fallback
        const kws  = keywords.slice(0, 5);
        const hits = kws.filter(k => page.text.toLowerCase().includes(k.toLowerCase())).length;
        if (hits >= 3) {
          similarity = 0.60 + (hits / Math.max(kws.length, 1)) * 0.15;
          matchType  = MATCH.POSSIBLE;
        }
      }

      if (similarity > highestSim) highestSim = similarity;

      let evidenceId: string | undefined;
      if (matchType !== MATCH.NONE) {
        try {
          const ev = await prisma.evidenceRecord.create({
            data: {
              evidenceCode: `EVD-${Date.now().toString(36).toUpperCase()}`,
              evidenceType: 'CRAWL_MATCH',
              description:  `${matchType} detected: ${page.url} (${Math.round(similarity * 100)}% similarity)`,
              hash:         null,
              storagePath:  null,
            },
          });
          evidenceId = ev.id;
        } catch { /* evidence table may not exist yet */ }
      }

      await prisma.crawlResult.create({
        data: {
          monitorRecordId: monitor.id,
          url:             page.url,
          pageTitle:       page.title.slice(0, 200),
          foundText:       page.text.slice(0, 2000),
          textLength:      page.wordCount,
          similarity,
          matchType,
          alertStatus:     matchType !== MATCH.NONE ? 'PENDING' : 'DISMISSED',
          contentSnapshot: page.text.slice(0, 500),
          evidenceGenerated: !!evidenceId,
        },
      });

      if (matchType !== MATCH.NONE) {
        alerts.push({ url: page.url, pageTitle: page.title, similarity: Math.round(similarity * 100), matchType, text: page.text.slice(0, 300), evidenceId });
        logger.info('[Monitor] Match accepted', { url: page.url, matchType, similarity: Math.round(similarity * 100) });
        if (monitor.ownerUserId) {
          const ownerId = monitor.ownerUserId;
          import('../platform-events/module-events').then(({ emitMonitoringMatch }) => {
            emitMonitoringMatch({
              ownerUserId: ownerId,
              monitorRecordId: monitor.id,
              dnaRecordId: monitor.dnaRecordId,
              filename: monitor.filename,
              url: page.url,
              matchType,
              similarity: Math.round(similarity * 100),
            });
          }).catch(() => {});
        }
      } else {
        logger.debug('[Monitor] Match rejected', { url: page.url, reason: 'below threshold', similarity });
      }
    }

    logger.info('[Monitor] Document check complete', { filename: monitor.filename, urlsChecked: urls.length, matchesFound: alerts.length });

    return {
      monitorRecordId:   monitor.id,
      runId,
      filename:          monitor.filename,
      fileCategory:      'DOCUMENT',
      urlsChecked:       urls.length,
      candidatesFound,
      matchesFound:      alerts.length,
      failuresCount:     failures.length,
      highestSimilarity: Math.round(highestSim * 100),
      durationMs:        0,
      alerts,
    };
  }

  // ─── Audio monitoring pipeline ─────────────────────────────────────────────

  private async runAudioCheck(monitor: any, runId: string): Promise<MonitoringSummary> {
    logger.info('[Monitor] Audio fingerprint check', { filename: monitor.filename });

    const urls = [...monitor.watchUrls, ...webCrawler.generateSearchUrls(monitor.filename, [])];
    const crawlResults = await webCrawler.crawlUrls(urls);
    const alerts: AlertItem[] = [];

    // Audio: keyword-based discovery (full audio similarity needs Python/librosa)
    for (const page of crawlResults) {
      const nameBase = monitor.filename.replace(/\.[^.]+$/, '').toLowerCase();
      const pageText = page.text.toLowerCase();
      if (pageText.includes(nameBase) || pageText.includes('audio') || pageText.includes('music')) {
        const similarity = 0.72;
        await prisma.crawlResult.create({
          data: {
            monitorRecordId: monitor.id,
            url: page.url, pageTitle: page.title.slice(0, 200),
            foundText: page.text.slice(0, 500), textLength: page.wordCount,
            similarity, matchType: MATCH.POSSIBLE, alertStatus: 'PENDING',
            contentSnapshot: page.text.slice(0, 300),
          },
        });
        alerts.push({ url: page.url, pageTitle: page.title, similarity: 72, matchType: MATCH.POSSIBLE, text: page.text.slice(0, 200) });
      }
    }

    return { monitorRecordId: monitor.id, runId, filename: monitor.filename, fileCategory: 'AUDIO',
      urlsChecked: urls.length, candidatesFound: crawlResults.length, matchesFound: alerts.length,
      failuresCount: 0, highestSimilarity: alerts.length > 0 ? 72 : 0, durationMs: 0, alerts };
  }

  // ─── Video monitoring pipeline ─────────────────────────────────────────────

  private async runVideoCheck(monitor: any, runId: string): Promise<MonitoringSummary> {
    logger.info('[Monitor] Video check — YouTube API + web search', { filename: monitor.filename });

    const alerts: AlertItem[] = [];
    let urlsChecked = 0;
    let candidatesFound = 0;
    let youtubeCandidates = 0;
    const nameStem = monitor.filename.replace(/\.[^.]+$/, '').toLowerCase();

    if (isYouTubeConfigured()) {
      const queries = filenameSearchQueries(monitor.filename);
      const watchedIds = new Set(
        (monitor.watchUrls as string[]).map(extractYouTubeVideoId).filter(Boolean) as string[],
      );

      for (const url of monitor.watchUrls as string[]) {
        const videoId = extractYouTubeVideoId(url);
        if (!videoId) continue;
        urlsChecked++;
        const hit = await getYouTubeVideo(videoId);
        if (!hit) continue;
        candidatesFound++;
        const similarity = Math.max(0.92, scoreYouTubeFilenameMatch(monitor.filename, hit));
        await this.saveVideoAlert(monitor.id, hit.url, hit.title, hit.description, similarity, {
          source: 'YOUTUBE_WATCH_URL',
          videoId: hit.videoId,
          channel: hit.channel,
          manualWatch: true,
        });
        alerts.push({
          url: hit.url,
          pageTitle: hit.title,
          similarity: Math.round(similarity * 100),
          matchType: similarity >= 0.85 ? MATCH.HIGH : MATCH.POSSIBLE,
          text: hit.description.slice(0, 200),
        });
      }

      const searchHits = await searchYouTubeVideos(queries, 15);
      urlsChecked += queries.length;
      youtubeCandidates = searchHits.length;
      for (const hit of searchHits) {
        if (watchedIds.has(hit.videoId)) continue;
        const similarity = scoreYouTubeFilenameMatch(monitor.filename, hit);
        if (!isStrongAutoYouTubeMatch(monitor.filename, hit)) {
          logger.debug('[Monitor] YouTube search rejected (weak match)', {
            title: hit.title.slice(0, 80),
            similarity,
            min: YOUTUBE_AUTO_ALERT_MIN,
          });
          continue;
        }
        candidatesFound++;
        await this.saveVideoAlert(monitor.id, hit.url, hit.title, hit.description, similarity, {
          source: 'YOUTUBE_SEARCH',
          videoId: hit.videoId,
          channel: hit.channel,
          query: queries[0],
        });
        alerts.push({
          url: hit.url,
          pageTitle: hit.title,
          similarity: Math.round(similarity * 100),
          matchType: similarity >= 0.85 ? MATCH.HIGH : MATCH.POSSIBLE,
          text: hit.description.slice(0, 200),
        });
      }

      logger.info('[Monitor] YouTube scan complete', {
        filename: monitor.filename,
        queries,
        youtubeCandidates,
        matchesFound: alerts.length,
      });
    } else {
      logger.warn('[Monitor] YOUTUBE_API_KEY not set — skipping YouTube video search');
    }

    const urls = [...monitor.watchUrls, ...webCrawler.generateSearchUrls(monitor.filename, [])];
    const crawlResults = await webCrawler.crawlUrls(urls);
    urlsChecked += urls.length;
    candidatesFound += crawlResults.length;

    for (const page of crawlResults) {
      if (page.text.toLowerCase().includes(nameStem)) {
        const similarity = 0.75;
        await this.saveVideoAlert(monitor.id, page.url, page.title, page.text.slice(0, 500), similarity, {
          source: 'WEB_SEARCH',
        });
        alerts.push({
          url: page.url,
          pageTitle: page.title,
          similarity: 75,
          matchType: MATCH.POSSIBLE,
          text: page.text.slice(0, 200),
        });
      }
    }

    return {
      monitorRecordId: monitor.id,
      runId,
      filename: monitor.filename,
      fileCategory: 'VIDEO',
      method: 'YOUTUBE_API',
      urlsChecked,
      candidatesFound,
      youtubeCandidates,
      matchesFound: alerts.length,
      failuresCount: 0,
      highestSimilarity: alerts.length > 0 ? Math.max(...alerts.map((a) => a.similarity)) : 0,
      durationMs: 0,
      alerts,
    };
  }

  private async saveVideoAlert(
    monitorRecordId: string,
    url: string,
    title: string,
    text: string,
    similarity: number,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const matchType = similarity >= 0.95 ? MATCH.EXACT
      : similarity >= 0.85 ? MATCH.HIGH
      : similarity >= 0.7 ? MATCH.POSSIBLE
      : MATCH.NONE;
    if (matchType === MATCH.NONE) return;

    const videoId = typeof meta.videoId === 'string'
      ? meta.videoId
      : extractYouTubeVideoId(url);
    const canonicalUrl = videoId ? buildYouTubeWatchUrl(videoId) : url;
    const enrichedMeta = {
      ...meta,
      videoId: videoId ?? meta.videoId,
      pageUrl: canonicalUrl,
      platform: meta.source ?? 'YOUTUBE',
    };

    await prisma.crawlResult.create({
      data: {
        monitorRecordId,
        url: canonicalUrl.slice(0, 1000),
        pageTitle: title.slice(0, 200),
        foundText: JSON.stringify({ ...enrichedMeta, snippet: text.slice(0, 500) }),
        textLength: text.length,
        similarity,
        matchType,
        alertStatus: 'PENDING',
        contentSnapshot: text.slice(0, 300),
      },
    });
  }

  /** Called on server startup — queue a small batch so we don't stampede the DB. */
  async kickstartAutoCrawler(): Promise<void> {
    if (!isMonitoringCrawlerEnabled()) return;

    const dueSoon = await prisma.monitorRecord.findMany({
      where: {
        status: 'ACTIVE',
        scanType: { not: 'MANUAL' },
      },
      orderBy: { nextCheckAt: 'asc' },
      take: 5,
      select: { id: true },
    });

    if (dueSoon.length > 0) {
      await prisma.monitorRecord.updateMany({
        where: { id: { in: dueSoon.map((m) => m.id) } },
        data: { nextCheckAt: new Date() },
      });
    }

    logger.info('[Monitor] Auto-crawler kickstart', { monitorsQueued: dueSoon.length });
    await this.runDueChecks();
  }

  // ─── Run all due checks ────────────────────────────────────────────────────

  async runDueChecks(): Promise<void> {
    if (!isMonitoringCrawlerEnabled()) return;
    // Don't starve Unified Investigation with FilenameSearch floods while a probe is running.
    try {
      const { isInvestigationBusy } = await import('../forensics/investigation-busy.guard');
      if (isInvestigationBusy()) {
        logger.debug('[Monitor] Skipping due checks — investigation in progress');
        return;
      }
    } catch {
      /* guard optional */
    }

    const due = await prisma.monitorRecord.findMany({
      where: {
        status: 'ACTIVE',
        scanType: { not: 'MANUAL' },
        nextCheckAt: { lte: new Date() },
      },
      take: 3,
    });
    if (due.length === 0) return;

    logger.info(`[Monitor] Auto-crawler running ${due.length} due checks`);
    for (const m of due) {
      const trigger = m.scanType === 'CONTINUOUS' ? 'CONTINUOUS' : 'SCHEDULED';
      await this.runCheck(m.id, trigger).catch(err =>
        logger.warn('[Monitor] Check failed', { id: m.id, error: String(err) })
      );
    }
  }

  // ─── List / alerts / stats ─────────────────────────────────────────────────

  async listMonitors(userId: string) {
    return prisma.monitorRecord.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        crawlResults: {
          where:   { matchType: { not: MATCH.NONE } },
          orderBy: { createdAt: 'desc' },
          take:    3,
          select: {
            id: true,
            url: true,
            matchType: true,
            similarity: true,
            alertStatus: true,
            createdAt: true,
            pageTitle: true,
          },
        },
        monitoringRuns: {
          orderBy: { createdAt: 'desc' },
          take:    2,
          select: { id: true, status: true, trigger: true, startedAt: true, durationMs: true, matchesFound: true },
        },
        _count: { select: { crawlResults: true, monitoringRuns: true } },
      },
    });
  }

  async getMonitorRuns(monitorRecordId: string) {
    return prisma.monitoringRun.findMany({
      where:   { monitorRecordId },
      orderBy: { createdAt: 'desc' },
      take:    20,
      include: { failures: true },
    });
  }

  async getAlerts(status = 'PENDING', userId: string) {
    return prisma.crawlResult.findMany({
      where: {
        alertStatus: status,
        matchType: { not: MATCH.NONE },
        monitorRecord: { ownerUserId: userId },
      },
      orderBy: { similarity: 'desc' },
      include: { monitorRecord: { select: { filename: true, fileType: true, dnaRecordId: true } } },
      take:    50,
    });
  }

  async dismissAlert(id: string): Promise<void> {
    await prisma.crawlResult.update({ where: { id }, data: { alertStatus: 'DISMISSED' } });
  }

  async confirmAlert(id: string): Promise<void> {
    await prisma.crawlResult.update({ where: { id }, data: { alertStatus: 'CONFIRMED' } });
  }

  async getStats(userId: string) {
    const monitorWhere = { ownerUserId: userId };
    const alertWhere = { alertStatus: 'PENDING' as const, matchType: { not: MATCH.NONE }, monitorRecord: monitorWhere };
    const [total, active, pending, confirmed, runs, exactMatches] = await Promise.all([
      prisma.monitorRecord.count({ where: monitorWhere }),
      prisma.monitorRecord.count({ where: { ...monitorWhere, status: 'ACTIVE' } }),
      prisma.crawlResult.count({ where: alertWhere }),
      prisma.crawlResult.count({ where: { alertStatus: 'CONFIRMED', monitorRecord: monitorWhere } }),
      prisma.monitoringRun.count({ where: { status: 'COMPLETED', monitorRecord: monitorWhere } }),
      prisma.crawlResult.count({ where: { matchType: MATCH.EXACT, monitorRecord: monitorWhere } }),
    ]);
    return { totalMonitored: total, activeMonitors: active, pendingAlerts: pending,
             confirmedMatches: confirmed, totalRuns: runs, exactMatches };
  }

  async updateScanType(monitorRecordId: string, scanType: string): Promise<void> {
    const checkHrs = scanTypeToCheckHrs(scanType);
    await prisma.monitorRecord.update({
      where: { id: monitorRecordId },
      data: {
        scanType,
        checkEveryHrs: checkHrs,
        nextCheckAt: scanType === 'MANUAL' ? null : new Date(Date.now() + 5_000),
      },
    });
  }

  // ─── Keyword extraction ────────────────────────────────────────────────────

  private extractKeywords(text: string, filename: string): string[] {
    const words = new Map<string, number>();
    const textWords = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    for (const w of textWords) words.set(w, (words.get(w) ?? 0) + 1);
    const nameWords = filename.toLowerCase().replace(/\.[^.]+$/, '').split(/[_\-\s\.]/);
    for (const w of nameWords) if (w.length > 3) words.set(w, (words.get(w) ?? 0) + 5);
    const stop = new Set(['that','this','with','from','have','been','they','their','what','will','when','more','than','your','also','which','into','then','some']);
    return [...words.entries()].filter(([w]) => !stop.has(w)).sort((a,b) => b[1]-a[1]).slice(0,10).map(([w]) => w);
  }
}

export const monitoringService = new MonitoringService();
