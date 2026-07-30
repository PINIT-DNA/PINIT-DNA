/**
 * Publish Guardian — orchestration service.
 * Reuses DNA / Vault / Certificate / Monitoring — does NOT implement new forensics.
 * Phase 2: lifecycle state machine, risk engine, domain events, monitoring profile.
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../../api/middleware/error.middleware';
import { UniversalFileRouter } from '../universal-file-router';
import { VaultService } from '../vault/vault.service';
import { certificateService } from '../certificates/certificate.service';
import { monitoringService } from '../crawler/monitoring.service';
import { duplicateCheckService } from '../duplicate/duplicate-check.service';
import {
  emitPublishGuardianProtected,
  emitPublishGuardianDiscovery,
} from '../platform-events/module-events';
import { assertTransition, MONITOR_PROFILE, type MonitorProfileStatus } from './lifecycle';
import { evaluateRisk, maxSeverity, type RiskSeverity } from './risk-engine';
import { publishGuardianEvents } from './domain-events';
import type {
  PublishProtectInput,
  PublishProtectResult,
  RegisterPostInput,
  RecordDiscoveryInput,
} from './types';

const router = new UniversalFileRouter();
const vaultService = new VaultService();

function normalizePlatform(raw: string): string {
  const p = raw.trim().toLowerCase();
  if (p === 'twitter' || p === 'x.com') return 'x';
  if (p === 'ig') return 'instagram';
  if (p === 'fb') return 'facebook';
  if (p === 'yt') return 'youtube';
  return p || 'web';
}

function uniqueUrls(urls: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const t = (u ?? '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export class PublishGuardianService {
  async publishProtect(input: PublishProtectInput): Promise<PublishProtectResult> {
    const platform = normalizePlatform(input.platform);
    const mediaHash = crypto.createHash('sha256').update(input.buffer).digest('hex');
    const enrollMonitoring = input.enrollMonitoring !== false;
    const issueCertificate = input.issueCertificate !== false;
    const clientRequestId = input.clientRequestId?.trim() || null;

    // Idempotent recovery — same client queue item must not double-protect
    if (clientRequestId) {
      const existing = await prisma.protectedPost.findFirst({
        where: { ownerUserId: input.ownerUserId, clientRequestId },
      });
      if (existing?.vaultId && existing.dnaRecordId && existing.status !== 'FAILED') {
        const owner = await prisma.user.findUnique({
          where: { id: input.ownerUserId },
          select: { shortId: true },
        });
        return {
          success: true,
          protectedPostId: existing.id,
          vaultId: existing.vaultId,
          dnaRecordId: existing.dnaRecordId,
          certificateId: existing.certificateId,
          monitorId: existing.monitorRecordId,
          mediaHash: existing.mediaHash ?? mediaHash,
          status: existing.status,
          monitorStatus: existing.monitorStatus,
          ownership: {
            ownerPinitId: owner?.shortId ?? null,
            registeredAt: existing.registeredAt.toISOString(),
          },
          message: 'Already protected (idempotent recovery)',
          idempotent: true,
        };
      }
      if (existing && (existing.status === 'FAILED' || existing.status === 'PUBLISHING')) {
        // Allow retry after failure / stalled publish — remove stub row
        await prisma.protectedPost.delete({ where: { id: existing.id } }).catch(() => {});
      }
    }

    const dup = await duplicateCheckService.check(
      input.buffer,
      input.mimeType,
      input.originalFileName,
      { user: { sub: input.ownerUserId }, headers: {}, ip: input.ip } as never,
    );
    if (dup.isDuplicate) {
      throw new AppError(
        409,
        dup.ownerShortId
          ? `This file already has DNA under another PINIT account (${dup.ownerShortId}).`
          : 'This file already has DNA under another PINIT account.',
      );
    }

    // Draft row for recovery visibility while pipeline runs
    const draft = await prisma.protectedPost.create({
      data: {
        ownerUserId: input.ownerUserId,
        platform,
        mediaHash,
        mediaType: input.mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE',
        postUrl: input.postUrl ?? null,
        currentUrl: input.postUrl ?? null,
        ownerAccount: input.ownerAccount ?? null,
        mediaUrl: input.mediaUrl ?? null,
        caption: input.caption ?? null,
        pageTitle: input.pageTitle ?? null,
        platformPostId: input.platformPostId ?? null,
        status: 'PUBLISHING',
        monitorStatus: MONITOR_PROFILE.PENDING,
        clientRequestId,
        extensionVersion: input.extensionVersion ?? null,
        capturedVia: input.capturedVia || 'extension_publish_guardian',
        metadata: {
          profileUrl: input.profileUrl ?? null,
          mimeType: input.mimeType,
          originalFileName: input.originalFileName,
        } as Prisma.InputJsonValue,
      },
    });

    const tmpPath = path.join(
      os.tmpdir(),
      `pinit_pg_${Date.now()}_${uuidv4().slice(0, 8)}${path.extname(input.originalFileName) || '.bin'}`,
    );
    await fs.writeFile(tmpPath, input.buffer);

    let dnaRecordId: string;
    try {
      try {
        const dna = await router.route({
          filePath: tmpPath,
          originalName: input.originalFileName,
          declaredMimeType: input.mimeType,
          sizeBytes: input.buffer.length,
          buffer: input.buffer,
          ownerUserId: input.ownerUserId,
          uploadStartMs: Date.now(),
          userAgent: input.userAgent ?? undefined,
          ip: input.ip ?? undefined,
        });
        dnaRecordId = dna.dnaRecordId;
        await prisma.dnaRecord.update({
          where: { id: dnaRecordId },
          data: { ownerUserId: input.ownerUserId },
        });
      } catch (err) {
        await this.failPost(draft.id, input.ownerUserId, String(err));
        throw err;
      }
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }

    let vaultId: string;
    try {
      const vault = await vaultService.store({
        dnaRecordId,
        ownerUserId: input.ownerUserId,
        imageBuffer: input.buffer,
        originalFileName: input.originalFileName,
        originalMimeType: input.mimeType,
      });
      vaultId = vault.vaultId;
    } catch (err) {
      await this.failPost(draft.id, input.ownerUserId, String(err));
      throw err;
    }

    let certificateId: string | null = null;
    if (issueCertificate) {
      try {
        const cert = await certificateService.issue({
          dnaRecordId,
          vaultId,
          issuedByUserId: input.ownerUserId,
          ownerUserId: input.ownerUserId,
        });
        certificateId = cert.certificateId;
        await publishGuardianEvents.emit({
          type: 'CertificateIssued',
          protectedPostId: draft.id,
          ownerUserId: input.ownerUserId,
          certificateId,
        });
      } catch (err) {
        logger.warn('[PublishGuardian] Certificate issue skipped', { error: String(err) });
      }
    }

    const watchUrls = uniqueUrls([input.postUrl, input.profileUrl, input.mediaUrl]);
    let monitorId: string | null = null;
    let monitorStatus: MonitorProfileStatus = MONITOR_PROFILE.PENDING;
    let lastMonitorError: string | null = null;
    let nextScanAt: Date | null = null;

    if (enrollMonitoring) {
      try {
        monitorId = await monitoringService.enroll(dnaRecordId, {
          ownerUserId: input.ownerUserId,
          watchUrls,
          scanType: 'CONTINUOUS',
        });
        monitorStatus = MONITOR_PROFILE.RUNNING;
        nextScanAt = new Date(Date.now() + 60_000);
        await publishGuardianEvents.emit({
          type: 'MonitoringEnrolled',
          protectedPostId: draft.id,
          ownerUserId: input.ownerUserId,
          monitorRecordId: monitorId,
          watchUrls,
        });
      } catch (err) {
        lastMonitorError = String(err);
        monitorStatus = MONITOR_PROFILE.FAILED;
        await publishGuardianEvents.emit({
          type: 'MonitoringFailed',
          protectedPostId: draft.id,
          ownerUserId: input.ownerUserId,
          error: lastMonitorError,
        });
        logger.warn('[PublishGuardian] Monitor enroll failed', { error: lastMonitorError });
      }
    }

    const lifecycleStatus = monitorId ? 'MONITORING' : 'PROTECTED';
    assertTransition('PUBLISHING', lifecycleStatus);

    const owner = await prisma.user.findUnique({
      where: { id: input.ownerUserId },
      select: { shortId: true },
    });

    const post = await prisma.protectedPost.update({
      where: { id: draft.id },
      data: {
        vaultId,
        dnaRecordId,
        certificateId,
        monitorRecordId: monitorId,
        monitorJobId: monitorId,
        monitorStatus,
        lastMonitorError,
        nextScanAt,
        watchUrls,
        publishedAt: new Date(),
        status: lifecycleStatus as never,
      },
    });

    await this.appendTimeline(post.id, {
      eventType: 'ORIGINAL_PUBLISHED',
      title: `Published on ${platform}`,
      detail: input.postUrl ?? input.pageTitle ?? input.originalFileName,
      platform,
      url: input.postUrl ?? null,
    });
    await this.appendTimeline(post.id, {
      eventType: 'PROTECTED',
      title: 'Stored in Vault with DNA',
      detail: `Vault ${vaultId.slice(0, 8)}… · DNA ${dnaRecordId.slice(0, 8)}…`,
      platform,
    });
    if (certificateId) {
      await this.appendTimeline(post.id, {
        eventType: 'PROTECTED',
        title: 'Certificate issued',
        detail: certificateId,
        platform,
      });
    }
    if (monitorId) {
      await this.appendTimeline(post.id, {
        eventType: 'MONITORING_STARTED',
        title: 'Monitoring profile running',
        detail: watchUrls.length
          ? `Job ${monitorId.slice(0, 8)}… · watching ${watchUrls.length} URL(s)`
          : `Job ${monitorId.slice(0, 8)}… · continuous`,
        platform,
      });
    } else if (monitorStatus === MONITOR_PROFILE.FAILED) {
      await this.appendTimeline(post.id, {
        eventType: 'NOTE',
        title: 'Monitoring enrollment failed',
        detail: lastMonitorError,
        platform,
      });
    }

    emitPublishGuardianProtected({
      ownerUserId: input.ownerUserId,
      protectedPostId: post.id,
      vaultId,
      dnaRecordId,
      certificateId,
      platform,
      filename: input.originalFileName,
      postUrl: input.postUrl ?? null,
    });

    await publishGuardianEvents.emit({
      type: 'PostProtected',
      protectedPostId: post.id,
      ownerUserId: input.ownerUserId,
      vaultId,
      dnaRecordId,
      certificateId,
      platform,
    });
    await publishGuardianEvents.emit({
      type: 'LifecycleChanged',
      protectedPostId: post.id,
      ownerUserId: input.ownerUserId,
      from: 'PUBLISHING',
      to: lifecycleStatus,
    });

    logger.info('[PublishGuardian] Protected', {
      protectedPostId: post.id,
      vaultId: vaultId.slice(0, 8),
      dnaRecordId: dnaRecordId.slice(0, 8),
      platform,
      monitorStatus,
    });

    // Additive Asset aggregate (does not change ProtectedPost behavior)
    let assetId: string | null = null;
    try {
      const { assetService } = await import('../assets/asset.service');
      const { inferAssetType } = await import('../assets/lifecycle');
      const asset = await assetService.ensureAssetFromProtect({
        ownerUserId: input.ownerUserId,
        assetType: inferAssetType(input.mimeType, input.originalFileName),
        originalFilename: input.originalFileName,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        contentHash: mediaHash,
        vaultId,
        dnaId: dnaRecordId,
        certificateId,
        monitorRecordId: monitorId,
        monitorStatus,
        sourcePlatform: platform,
        sourceUrl: input.postUrl ?? null,
        capturedVia: input.capturedVia || 'extension_publish_guardian',
        clientRequestId: clientRequestId || `pg:${post.id}`,
        status: lifecycleStatus === 'MONITORING' ? 'MONITORING' : 'PROTECTED',
        protectedPostId: post.id,
        metadata: {
          pageTitle: input.pageTitle ?? null,
          profileUrl: input.profileUrl ?? null,
        },
      });
      assetId = asset.id;
    } catch (err) {
      logger.warn('[PublishGuardian] Asset link skipped', { error: String(err) });
    }

    return {
      success: true,
      protectedPostId: post.id,
      assetId,
      vaultId,
      dnaRecordId,
      certificateId,
      monitorId,
      mediaHash,
      status: lifecycleStatus,
      monitorStatus,
      ownership: {
        ownerPinitId: owner?.shortId ?? null,
        registeredAt: post.registeredAt.toISOString(),
      },
      message: monitorId
        ? 'Protected, certified, and monitoring running'
        : monitorStatus === MONITOR_PROFILE.FAILED
          ? 'Protected — monitoring enrollment failed (will retry on register-post)'
          : 'Protected and stored in Vault',
    };
  }

  async registerPost(input: RegisterPostInput) {
    const platform = normalizePlatform(input.platform);
    const watchExtra = uniqueUrls([input.postUrl, input.profileUrl, input.mediaUrl]);

    let post = input.protectedPostId
      ? await prisma.protectedPost.findFirst({
          where: { id: input.protectedPostId, ownerUserId: input.ownerUserId },
        })
      : input.vaultId
        ? await prisma.protectedPost.findFirst({
            where: { vaultId: input.vaultId, ownerUserId: input.ownerUserId },
            orderBy: { createdAt: 'desc' },
          })
        : null;

    if (!post) throw new AppError(404, 'Protected post not found for this vault/id');

    const watchUrls = uniqueUrls([...post.watchUrls, ...watchExtra]);
    const nextUrl = input.postUrl ?? post.currentUrl ?? post.postUrl;

    post = await prisma.protectedPost.update({
      where: { id: post.id },
      data: {
        platform,
        platformPostId: input.platformPostId ?? post.platformPostId,
        postUrl: input.postUrl ?? post.postUrl,
        currentUrl: nextUrl,
        ownerAccount: input.ownerAccount ?? post.ownerAccount,
        mediaUrl: input.mediaUrl ?? post.mediaUrl,
        publishedAt: input.publishedAt ? new Date(input.publishedAt) : post.publishedAt,
        watchUrls,
      },
    });

    if (post.monitorRecordId && watchExtra.length) {
      await prisma.monitorRecord.update({
        where: { id: post.monitorRecordId },
        data: {
          watchUrls: { set: watchUrls },
          nextCheckAt: new Date(Date.now() + 5_000),
        },
      }).catch(() => {});
      await prisma.protectedPost.update({
        where: { id: post.id },
        data: { nextScanAt: new Date(Date.now() + 5_000), monitorStatus: MONITOR_PROFILE.RUNNING },
      });
    } else if (post.dnaRecordId && (!post.monitorRecordId || post.monitorStatus === MONITOR_PROFILE.FAILED)) {
      try {
        const monitorId = await monitoringService.enroll(post.dnaRecordId, {
          ownerUserId: input.ownerUserId,
          watchUrls,
          scanType: 'CONTINUOUS',
        });
        assertTransition(post.status, 'MONITORING');
        post = await prisma.protectedPost.update({
          where: { id: post.id },
          data: {
            monitorRecordId: monitorId,
            monitorJobId: monitorId,
            monitorStatus: MONITOR_PROFILE.RUNNING,
            nextScanAt: new Date(Date.now() + 60_000),
            lastMonitorError: null,
            status: 'MONITORING',
          },
        });
        await this.appendTimeline(post.id, {
          eventType: 'MONITORING_STARTED',
          title: 'Monitoring profile running',
          detail: `Job ${monitorId.slice(0, 8)}… · watching ${watchUrls.length} URL(s)`,
          platform,
        });
        await publishGuardianEvents.emit({
          type: 'MonitoringEnrolled',
          protectedPostId: post.id,
          ownerUserId: input.ownerUserId,
          monitorRecordId: monitorId,
          watchUrls,
        });
      } catch (err) {
        await prisma.protectedPost.update({
          where: { id: post.id },
          data: {
            monitorStatus: MONITOR_PROFILE.FAILED,
            lastMonitorError: String(err),
          },
        });
        logger.warn('[PublishGuardian] Late monitor enroll failed', { error: String(err) });
      }
    }

    await this.appendTimeline(post.id, {
      eventType: 'STATUS_CHANGE',
      title: 'Post URL registered',
      detail: input.postUrl ?? input.platformPostId ?? 'Metadata updated',
      platform,
      url: input.postUrl ?? null,
    });

    return post;
  }

  async listPosts(ownerUserId: string, opts?: { platform?: string; status?: string; q?: string }) {
    const where: Prisma.ProtectedPostWhereInput = { ownerUserId };
    if (opts?.platform) where.platform = normalizePlatform(opts.platform);
    if (opts?.status) where.status = opts.status as never;
    if (opts?.q?.trim()) {
      const q = opts.q.trim();
      where.OR = [
        { postUrl: { contains: q, mode: 'insensitive' } },
        { currentUrl: { contains: q, mode: 'insensitive' } },
        { ownerAccount: { contains: q, mode: 'insensitive' } },
        { caption: { contains: q, mode: 'insensitive' } },
        { platformPostId: { contains: q, mode: 'insensitive' } },
      ];
    }

    return prisma.protectedPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { discoveries: true, timeline: true } },
        discoveries: {
          orderBy: { lastSeenAt: 'desc' },
          take: 3,
          select: {
            id: true,
            discoveryUrl: true,
            matchType: true,
            dnaMatchPercent: true,
            tampered: true,
            severity: true,
            createdAt: true,
            lastSeenAt: true,
          },
        },
      },
    });
  }

  /** Cross-browser extension sync payload */
  async syncForExtension(ownerUserId: string) {
    const [posts, stats] = await Promise.all([
      prisma.protectedPost.findMany({
        where: { ownerUserId, status: { not: 'ARCHIVED' } },
        orderBy: { updatedAt: 'desc' },
        take: 200,
        select: {
          id: true,
          platform: true,
          postUrl: true,
          currentUrl: true,
          status: true,
          monitorStatus: true,
          riskScore: true,
          riskSeverity: true,
          discoveriesCount: true,
          tamperedCount: true,
          vaultId: true,
          dnaRecordId: true,
          certificateId: true,
          clientRequestId: true,
          updatedAt: true,
          lastScanAt: true,
          nextScanAt: true,
        },
      }),
      import('./analytics.service').then((m) => m.getPublishGuardianStats(ownerUserId)),
    ]);
    return {
      syncedAt: new Date().toISOString(),
      posts,
      stats,
    };
  }

  async getPost(ownerUserId: string, id: string) {
    const post = await prisma.protectedPost.findFirst({
      where: { id, ownerUserId },
      include: {
        timeline: { orderBy: { createdAt: 'asc' } },
        discoveries: { orderBy: { lastSeenAt: 'desc' } },
        dnaRecord: {
          select: {
            id: true,
            imageFilename: true,
            imageMimeType: true,
            sha256Hash: true,
            status: true,
            createdAt: true,
            fileAnalysisLabel: true,
          },
        },
      },
    });
    if (!post) throw new AppError(404, 'Protected post not found');
    return {
      ...post,
      aggregate: {
        vaultAsset: post.vaultId,
        dnaRecord: post.dnaRecordId,
        certificate: post.certificateId,
        monitoringJob: post.monitorJobId ?? post.monitorRecordId,
        monitoringProfile: post.monitorStatus,
        timelineCount: post.timeline.length,
        discoveriesCount: post.discoveries.length,
        investigations: post.discoveries.filter((d) => d.investigationId).map((d) => d.investigationId),
        evidence: post.discoveries.filter((d) => d.evidenceId || d.evidenceReady).map((d) => d.evidenceId ?? d.id),
      },
    };
  }

  async updatePost(
    ownerUserId: string,
    id: string,
    data: {
      status?: string;
      monitorStatus?: string;
      postUrl?: string | null;
      currentUrl?: string | null;
      ownerAccount?: string | null;
      watchUrls?: string[];
    },
  ) {
    const existing = await prisma.protectedPost.findFirst({ where: { id, ownerUserId } });
    if (!existing) throw new AppError(404, 'Protected post not found');

    if (data.status && data.status !== existing.status) {
      assertTransition(existing.status, data.status);
    }

    const updated = await prisma.protectedPost.update({
      where: { id },
      data: {
        status: data.status ? (data.status as never) : undefined,
        monitorStatus: data.monitorStatus ?? undefined,
        postUrl: data.postUrl === undefined ? undefined : data.postUrl,
        currentUrl: data.currentUrl === undefined ? undefined : data.currentUrl,
        ownerAccount: data.ownerAccount === undefined ? undefined : data.ownerAccount,
        watchUrls: data.watchUrls ? { set: uniqueUrls(data.watchUrls) } : undefined,
      },
    });

    if (data.status && data.status !== existing.status) {
      await this.appendTimeline(id, {
        eventType: data.status === 'RESOLVED' ? 'RESOLVED' : 'STATUS_CHANGE',
        title: `Lifecycle ${existing.status} → ${data.status}`,
        detail: `Monitoring profile: ${updated.monitorStatus}`,
        platform: existing.platform,
      });
      await publishGuardianEvents.emit({
        type: 'LifecycleChanged',
        protectedPostId: id,
        ownerUserId,
        from: existing.status,
        to: data.status,
      });
      if (data.status === 'RESOLVED') {
        await publishGuardianEvents.emit({ type: 'PostResolved', protectedPostId: id, ownerUserId });
      }
    }

    return updated;
  }

  async deletePost(ownerUserId: string, id: string) {
    const existing = await prisma.protectedPost.findFirst({ where: { id, ownerUserId } });
    if (!existing) throw new AppError(404, 'Protected post not found');
    assertTransition(existing.status, 'ARCHIVED');
    return prisma.protectedPost.update({
      where: { id },
      data: { status: 'ARCHIVED', monitorStatus: MONITOR_PROFILE.DISABLED },
    });
  }

  async recordDiscoveryFromMonitor(input: RecordDiscoveryInput): Promise<void> {
    try {
      const posts = await prisma.protectedPost.findMany({
        where: {
          dnaRecordId: input.dnaRecordId,
          status: { not: 'ARCHIVED' },
          ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
        },
        take: 5,
      });
      if (!posts.length) return;

      const similarity = Number.isFinite(input.similarity) ? input.similarity : 0;
      const sim01 = similarity <= 1 ? similarity : similarity / 100;
      const dnaMatchPercent = sim01 * 100;
      const tampered = !/EXACT|DUPLICATE/i.test(input.matchType) && dnaMatchPercent < 98;

      for (const post of posts) {
        const risk = evaluateRisk({
          similarity: sim01,
          matchType: input.matchType,
          tampered,
          dnaMatchPercent,
          priorDiscoveries: post.discoveriesCount,
          priorTampered: post.tamperedCount,
        });

        const existing = await prisma.protectedPostDiscovery.findFirst({
          where: { protectedPostId: post.id, discoveryUrl: input.discoveryUrl },
        });

        if (existing) {
          await prisma.protectedPostDiscovery.update({
            where: { id: existing.id },
            data: {
              lastSeenAt: new Date(),
              dnaMatchPercent: Math.max(existing.dnaMatchPercent, dnaMatchPercent),
              similarity: Math.max(existing.similarity, sim01),
              similarityScore: Math.max(existing.similarityScore, dnaMatchPercent),
              riskScore: Math.max(existing.riskScore, risk.score),
              severity: maxSeverity(existing.severity as RiskSeverity, risk.severity),
              tampered: existing.tampered || tampered,
              tamperingStatus: existing.tampered || tampered ? 'TAMPERED' : 'CLEAN',
            },
          });
          await prisma.protectedPost.update({
            where: { id: post.id },
            data: {
              lastDiscoveryAt: new Date(),
              lastScanAt: new Date(),
              riskScore: Math.max(post.riskScore, risk.score),
              riskSeverity: maxSeverity((post.riskSeverity as RiskSeverity) || 'LOW', risk.severity),
            },
          });
          continue;
        }

        const nextStatus = tampered ? 'TAMPERING' : 'DISCOVERY';
        if (canTransitionSafe(post.status, nextStatus)) {
          /* ok */
        }

        const discovery = await prisma.protectedPostDiscovery.create({
          data: {
            protectedPostId: post.id,
            platform: input.platform ?? post.platform,
            sourcePlatform: input.platform ?? post.platform,
            discoveryUrl: input.discoveryUrl,
            pageTitle: input.pageTitle ?? null,
            matchType: input.matchType,
            dnaMatchPercent,
            similarity: sim01,
            similarityScore: dnaMatchPercent,
            tampered,
            tamperingStatus: tampered ? 'TAMPERED' : 'CLEAN',
            tamperSummary: tampered ? 'Possible edit / recompress / crop vs vault original' : null,
            confidence: Math.min(1, dnaMatchPercent / 100),
            riskScore: risk.score,
            severity: risk.severity,
            matchedVaultId: post.vaultId,
            matchedDnaRecordId: post.dnaRecordId,
            crawlResultId: input.crawlResultId ?? null,
            alertStatus: risk.recommendAlert ? 'PENDING' : 'INFO',
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            payload: { riskReasons: risk.reasons } as Prisma.InputJsonValue,
          },
        });

        await prisma.protectedPost.update({
          where: { id: post.id },
          data: {
            discoveriesCount: { increment: 1 },
            tamperedCount: tampered ? { increment: 1 } : undefined,
            lastDiscoveryAt: new Date(),
            lastScanAt: new Date(),
            riskScore: Math.max(post.riskScore, risk.score),
            riskSeverity: maxSeverity((post.riskSeverity as RiskSeverity) || 'LOW', risk.severity),
            status: canTransitionSafe(post.status, nextStatus) ? (nextStatus as never) : post.status,
            monitorStatus: MONITOR_PROFILE.RUNNING,
          },
        });

        await this.appendTimeline(post.id, {
          eventType: tampered ? 'TAMPERING' : 'DISCOVERY',
          title: tampered ? 'Tampered copy discovered' : 'Copy discovered',
          detail: `${input.matchType} · ${Math.round(dnaMatchPercent)}% · ${risk.severity}`,
          platform: input.platform ?? post.platform,
          url: input.discoveryUrl,
          dnaMatchPercent,
          tampered,
          riskScore: risk.score,
          confidence: dnaMatchPercent,
          crawlResultId: input.crawlResultId ?? null,
        });

        if (risk.recommendAlert) {
          emitPublishGuardianDiscovery({
            ownerUserId: post.ownerUserId,
            protectedPostId: post.id,
            discoveryId: discovery.id,
            platform: input.platform ?? post.platform,
            discoveryUrl: input.discoveryUrl,
            dnaMatchPercent,
            tampered,
            riskScore: risk.score,
            matchType: input.matchType,
          });
        }

        await publishGuardianEvents.emit({
          type: 'DiscoveryFound',
          protectedPostId: post.id,
          ownerUserId: post.ownerUserId,
          discoveryId: discovery.id,
          discoveryUrl: input.discoveryUrl,
          riskScore: risk.score,
          severity: risk.severity,
          tampered,
        });
        if (tampered) {
          await publishGuardianEvents.emit({
            type: 'TamperingDetected',
            protectedPostId: post.id,
            ownerUserId: post.ownerUserId,
            discoveryId: discovery.id,
            riskScore: risk.score,
          });
        }

        // Mirror discovery onto Asset aggregate when linked
        if (post.assetId) {
          try {
            const { assetService } = await import('../assets/asset.service');
            await assetService.recordDiscovery({
              assetId: post.assetId,
              ownerUserId: post.ownerUserId,
              platform: input.platform ?? post.platform,
              url: input.discoveryUrl,
              similarity: sim01,
              tampered,
              confidence: Math.min(1, dnaMatchPercent / 100),
              severity: risk.severity,
              riskScore: risk.score,
              matchedVaultId: post.vaultId,
              matchedDnaId: post.dnaRecordId,
              pageTitle: input.pageTitle ?? null,
            });
          } catch (assetErr) {
            logger.warn('[PublishGuardian] Asset discovery mirror skipped', { error: String(assetErr) });
          }
        }
      }
    } catch (err) {
      logger.warn('[PublishGuardian] recordDiscoveryFromMonitor failed', { error: String(err) });
    }
  }

  async markScan(dnaRecordId: string, durationMs?: number): Promise<void> {
    try {
      const posts = await prisma.protectedPost.findMany({
        where: { dnaRecordId, status: { not: 'ARCHIVED' } },
        select: { id: true, avgScanMs: true },
      });
      for (const p of posts) {
        const avg = durationMs != null
          ? Math.round(((p.avgScanMs ?? durationMs) + durationMs) / 2)
          : p.avgScanMs;
        await prisma.protectedPost.update({
          where: { id: p.id },
          data: {
            lastScanAt: new Date(),
            nextScanAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            avgScanMs: avg ?? undefined,
            monitorStatus: MONITOR_PROFILE.RUNNING,
          },
        });
        await this.appendTimeline(p.id, {
          eventType: 'MONITORING_SCAN',
          title: 'Monitoring scan completed',
          detail: durationMs != null ? `${durationMs}ms` : null,
        }).catch(() => {});
      }
    } catch {
      /* non-fatal */
    }
  }

  private async failPost(id: string, ownerUserId: string, error: string) {
    await prisma.protectedPost.update({
      where: { id },
      data: {
        status: 'FAILED',
        monitorStatus: MONITOR_PROFILE.FAILED,
        lastMonitorError: error.slice(0, 2000),
      },
    }).catch(() => {});
    await this.appendTimeline(id, {
      eventType: 'NOTE',
      title: 'Protect failed',
      detail: error.slice(0, 500),
    }).catch(() => {});
    await publishGuardianEvents.emit({
      type: 'LifecycleChanged',
      protectedPostId: id,
      ownerUserId,
      from: 'PUBLISHING',
      to: 'FAILED',
    });
  }

  private async appendTimeline(
    protectedPostId: string,
    event: {
      eventType: string;
      title: string;
      detail?: string | null;
      platform?: string | null;
      url?: string | null;
      dnaMatchPercent?: number | null;
      tampered?: boolean | null;
      riskScore?: number | null;
      confidence?: number | null;
      investigationId?: string | null;
      evidenceId?: string | null;
      crawlResultId?: string | null;
    },
  ) {
    await prisma.protectedPostTimelineEvent.create({
      data: {
        protectedPostId,
        eventType: event.eventType as never,
        title: event.title,
        detail: event.detail ?? null,
        platform: event.platform ?? null,
        url: event.url ?? null,
        dnaMatchPercent: event.dnaMatchPercent ?? null,
        tampered: event.tampered ?? null,
        riskScore: event.riskScore ?? null,
        confidence: event.confidence ?? null,
        investigationId: event.investigationId ?? null,
        evidenceId: event.evidenceId ?? null,
        crawlResultId: event.crawlResultId ?? null,
      },
    });
  }
}

function canTransitionSafe(from: string, to: string): boolean {
  try {
    assertTransition(from, to);
    return true;
  } catch {
    return from === to;
  }
}

export const publishGuardianService = new PublishGuardianService();
