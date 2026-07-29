/**
 * Universal Asset service — Asset-first protection layer.
 * Reuses Vault / DNA / Certificate / Monitoring / Publish Guardian — no duplicated forensics.
 */

import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { publishGuardianService } from '../publish-guardian/publish-guardian.service';
import { assertAssetTransition, inferAssetType, ASSET_STATUS } from './lifecycle';
import { buildVideoAssetDna } from './video-asset-dna.service';
import { buildDocumentAssetDna } from './document-asset-dna.service';
import type { PublishProtectInput } from '../publish-guardian/types';

export interface AssetProtectInput {
  ownerUserId: string;
  buffer: Buffer;
  originalFileName: string;
  mimeType: string;
  platform?: string | null;
  sourceUrl?: string | null;
  mediaUrl?: string | null;
  profileUrl?: string | null;
  caption?: string | null;
  pageTitle?: string | null;
  ownerAccount?: string | null;
  platformPostId?: string | null;
  clientRequestId?: string | null;
  capturedVia?: string | null;
  extensionVersion?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  enrollMonitoring?: boolean;
  issueCertificate?: boolean;
  /** When false, still creates ProtectedPost via PG for platform tracking (default true path). */
  createProtectedPost?: boolean;
}

export class AssetService {
  /**
   * Protect any digital asset. Delegates DNA/Vault/Cert/Monitor to Publish Guardian,
   * then ensures an Asset aggregate exists and is linked.
   */
  async protect(input: AssetProtectInput) {
    const assetType = inferAssetType(input.mimeType, input.originalFileName);
    const platform = (input.platform || 'web').toLowerCase();

    const pgInput: PublishProtectInput = {
      ownerUserId: input.ownerUserId,
      buffer: input.buffer,
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      platform,
      postUrl: input.sourceUrl ?? null,
      mediaUrl: input.mediaUrl ?? null,
      profileUrl: input.profileUrl ?? null,
      caption: input.caption ?? null,
      pageTitle: input.pageTitle ?? null,
      ownerAccount: input.ownerAccount ?? null,
      platformPostId: input.platformPostId ?? null,
      clientRequestId: input.clientRequestId ?? null,
      extensionVersion: input.extensionVersion ?? null,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
      enrollMonitoring: input.enrollMonitoring,
      issueCertificate: input.issueCertificate,
    };

    const result = await publishGuardianService.publishProtect(pgInput);

    // Enrich fingerprints for video/document (additive; PG already stored DNA)
    let fingerprints: Prisma.InputJsonValue | undefined;
    if (assetType === 'VIDEO') {
      try {
        fingerprints = (await buildVideoAssetDna(input.buffer)) as unknown as Prisma.InputJsonValue;
      } catch {
        fingerprints = { engine: 'video', error: 'generation_failed' };
      }
    } else if (assetType === 'DOCUMENT') {
      try {
        fingerprints = (await buildDocumentAssetDna({
          buffer: input.buffer,
          mimeType: input.mimeType,
          originalFilename: input.originalFileName,
          dnaRecordId: result.dnaRecordId,
        })) as unknown as Prisma.InputJsonValue;
      } catch {
        fingerprints = { engine: 'document', error: 'generation_failed' };
      }
    }

    const asset = await this.ensureAssetFromProtect({
      ownerUserId: input.ownerUserId,
      assetType,
      originalFilename: input.originalFileName,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      contentHash: crypto.createHash('sha256').update(input.buffer).digest('hex'),
      vaultId: result.vaultId,
      dnaId: result.dnaRecordId,
      certificateId: result.certificateId,
      monitorRecordId: result.monitorId,
      monitorStatus: result.monitorStatus || 'PENDING',
      sourcePlatform: platform,
      sourceUrl: input.sourceUrl ?? null,
      capturedVia: input.capturedVia || 'extension_publish_guardian',
      clientRequestId: input.clientRequestId ?? `pg:${result.protectedPostId}`,
      status: result.monitorId ? ASSET_STATUS.MONITORING : ASSET_STATUS.PROTECTED,
      fingerprints,
      protectedPostId: result.protectedPostId,
      metadata: {
        pageTitle: input.pageTitle ?? null,
        exportProtect: String(input.capturedVia || '').includes('export'),
      },
    });

    return {
      success: true as const,
      asset,
      protectedPostId: result.protectedPostId,
      vaultId: result.vaultId,
      dnaRecordId: result.dnaRecordId,
      certificateId: result.certificateId,
      monitorId: result.monitorId,
      message: result.message,
      idempotent: result.idempotent,
    };
  }

  /** Called from Publish Guardian after a successful protect (idempotent). */
  async ensureAssetFromProtect(opts: {
    ownerUserId: string;
    assetType: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO' | 'OTHER';
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
    vaultId: string;
    dnaId: string;
    certificateId: string | null;
    monitorRecordId: string | null;
    monitorStatus: string;
    sourcePlatform: string;
    sourceUrl?: string | null;
    capturedVia: string;
    clientRequestId: string;
    status: string;
    fingerprints?: Prisma.InputJsonValue;
    protectedPostId: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const existing = await prisma.asset.findFirst({
      where: {
        ownerUserId: opts.ownerUserId,
        OR: [
          { clientRequestId: opts.clientRequestId },
          { dnaId: opts.dnaId },
        ],
      },
    });

    let asset = existing;
    if (!asset) {
      assertAssetTransition(ASSET_STATUS.DRAFT, opts.status);
      asset = await prisma.asset.create({
        data: {
          ownerUserId: opts.ownerUserId,
          assetType: opts.assetType,
          status: opts.status as never,
          originalFilename: opts.originalFilename,
          mimeType: opts.mimeType,
          sizeBytes: opts.sizeBytes,
          contentHash: opts.contentHash,
          vaultId: opts.vaultId,
          dnaId: opts.dnaId,
          certificateId: opts.certificateId,
          monitorRecordId: opts.monitorRecordId,
          monitorJobId: opts.monitorRecordId,
          monitorStatus: opts.monitorStatus,
          sourcePlatform: opts.sourcePlatform,
          sourceUrl: opts.sourceUrl ?? null,
          capturedVia: opts.capturedVia,
          clientRequestId: opts.clientRequestId,
          fingerprints: opts.fingerprints,
          metadata: opts.metadata,
        },
      });
      await this.appendTimeline(asset.id, {
        eventType: 'CREATED',
        title: 'Asset registered',
        detail: opts.originalFilename,
        platform: opts.sourcePlatform,
      });
      await this.appendTimeline(asset.id, {
        eventType: 'PROTECTED',
        title: 'Vault + DNA linked',
        detail: `Vault ${opts.vaultId.slice(0, 8)}…`,
        platform: opts.sourcePlatform,
      });
      if (opts.certificateId) {
        await this.appendTimeline(asset.id, {
          eventType: 'CERTIFICATE',
          title: 'Certificate issued',
          detail: opts.certificateId,
        });
      }
      if (opts.monitorRecordId) {
        await this.appendTimeline(asset.id, {
          eventType: 'MONITORING_STARTED',
          title: 'Monitoring enrolled',
          detail: opts.monitorRecordId.slice(0, 8),
        });
      }
      if (String(opts.capturedVia).includes('export')) {
        await this.appendTimeline(asset.id, {
          eventType: 'EXPORT_CAPTURE',
          title: 'Protected on export',
          platform: opts.sourcePlatform,
        });
      }
    } else if (opts.fingerprints) {
      asset = await prisma.asset.update({
        where: { id: asset.id },
        data: { fingerprints: opts.fingerprints },
      });
    }

    await prisma.protectedPost.updateMany({
      where: { id: opts.protectedPostId, ownerUserId: opts.ownerUserId },
      data: { assetId: asset.id },
    });

    return asset;
  }

  async list(ownerUserId: string, opts?: { assetType?: string; status?: string; limit?: number }) {
    const take = Math.min(opts?.limit ?? 50, 100);
    return prisma.asset.findMany({
      where: {
        ownerUserId,
        ...(opts?.assetType ? { assetType: opts.assetType as never } : {}),
        ...(opts?.status ? { status: opts.status as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        _count: { select: { discoveries: true, protectedPosts: true, timeline: true } },
      },
    });
  }

  async get(ownerUserId: string, id: string) {
    const asset = await prisma.asset.findFirst({
      where: { id, ownerUserId },
      include: {
        timeline: { orderBy: { createdAt: 'desc' }, take: 100 },
        discoveries: { orderBy: { lastSeen: 'desc' }, take: 50 },
        protectedPosts: {
          select: {
            id: true,
            platform: true,
            postUrl: true,
            status: true,
            monitorStatus: true,
            riskSeverity: true,
            createdAt: true,
          },
        },
        dnaRecord: {
          select: { id: true, imageFilename: true, fileType: true, sha256Hash: true, status: true },
        },
      },
    });
    if (!asset) throw new AppError(404, 'Asset not found');
    return asset;
  }

  async getStats(ownerUserId: string) {
    const [total, byType, byStatus, discoveries, monitoring] = await Promise.all([
      prisma.asset.count({ where: { ownerUserId } }),
      prisma.asset.groupBy({ by: ['assetType'], where: { ownerUserId }, _count: true }),
      prisma.asset.groupBy({ by: ['status'], where: { ownerUserId }, _count: true }),
      prisma.assetDiscovery.count({ where: { asset: { ownerUserId } } }),
      prisma.asset.count({ where: { ownerUserId, monitorStatus: 'RUNNING' } }),
    ]);
    return {
      totalAssets: total,
      monitoringRunning: monitoring,
      totalDiscoveries: discoveries,
      byType: Object.fromEntries(byType.map((r) => [r.assetType, r._count])),
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
    };
  }

  async transition(ownerUserId: string, id: string, toStatus: string) {
    const asset = await prisma.asset.findFirst({ where: { id, ownerUserId } });
    if (!asset) throw new AppError(404, 'Asset not found');
    assertAssetTransition(asset.status, toStatus);
    const updated = await prisma.asset.update({
      where: { id },
      data: { status: toStatus as never },
    });
    await this.appendTimeline(id, {
      eventType: 'STATUS_CHANGE',
      title: `Status → ${toStatus}`,
      detail: `${asset.status} → ${toStatus}`,
    });
    return updated;
  }

  async recordDiscovery(opts: {
    assetId: string;
    ownerUserId?: string;
    platform?: string | null;
    url: string;
    similarity: number;
    tampered?: boolean;
    confidence?: number;
    severity?: string;
    riskScore?: number;
    investigationId?: string | null;
    evidenceId?: string | null;
    matchedVaultId?: string | null;
    matchedDnaId?: string | null;
    pageTitle?: string | null;
  }) {
    const asset = await prisma.asset.findFirst({
      where: {
        id: opts.assetId,
        ...(opts.ownerUserId ? { ownerUserId: opts.ownerUserId } : {}),
      },
    });
    if (!asset) return null;

    const existing = await prisma.assetDiscovery.findFirst({
      where: { assetId: opts.assetId, url: opts.url },
    });

    let discovery;
    if (existing) {
      discovery = await prisma.assetDiscovery.update({
        where: { id: existing.id },
        data: {
          lastSeen: new Date(),
          similarity: opts.similarity,
          similarityScore: opts.similarity,
          tampered: opts.tampered ?? existing.tampered,
          tampering: opts.tampered ? 'TAMPERED' : existing.tampering,
          confidence: opts.confidence ?? existing.confidence,
          severity: opts.severity ?? existing.severity,
          riskScore: opts.riskScore ?? existing.riskScore,
          investigationId: opts.investigationId ?? existing.investigationId,
          evidenceId: opts.evidenceId ?? existing.evidenceId,
        },
      });
    } else {
      discovery = await prisma.assetDiscovery.create({
        data: {
          assetId: opts.assetId,
          platform: opts.platform ?? null,
          sourcePlatform: opts.platform ?? null,
          url: opts.url,
          pageTitle: opts.pageTitle ?? null,
          similarity: opts.similarity,
          similarityScore: opts.similarity,
          tampered: !!opts.tampered,
          tampering: opts.tampered ? 'TAMPERED' : 'CLEAN',
          confidence: opts.confidence ?? opts.similarity,
          severity: opts.severity ?? 'LOW',
          riskScore: opts.riskScore ?? 0,
          matchedVaultId: opts.matchedVaultId ?? asset.vaultId,
          matchedDnaId: opts.matchedDnaId ?? asset.dnaId,
          matchedAssetId: asset.id,
          investigationId: opts.investigationId ?? null,
          evidenceId: opts.evidenceId ?? null,
        },
      });
      await prisma.asset.update({
        where: { id: asset.id },
        data: {
          discoveriesCount: { increment: 1 },
          lastDiscoveryAt: new Date(),
          status: asset.status === 'ARCHIVED' ? asset.status : ('DISCOVERY' as never),
        },
      });
      if (asset.status !== 'ARCHIVED' && asset.status !== 'DISCOVERY') {
        try {
          assertAssetTransition(asset.status, ASSET_STATUS.DISCOVERY);
        } catch {
          /* keep prior status if transition invalid */
        }
      }
      await this.appendTimeline(asset.id, {
        eventType: opts.tampered ? 'TAMPERING' : 'DISCOVERY',
        title: opts.tampered ? 'Tampering signal' : 'Discovery found',
        detail: opts.url,
        platform: opts.platform ?? undefined,
        url: opts.url,
        similarity: opts.similarity,
        tampered: !!opts.tampered,
        riskScore: opts.riskScore,
        confidence: opts.confidence,
      });
    }
    return discovery;
  }

  async appendTimeline(
    assetId: string,
    event: {
      eventType: string;
      title: string;
      detail?: string | null;
      platform?: string | null;
      url?: string | null;
      similarity?: number | null;
      tampered?: boolean | null;
      riskScore?: number | null;
      confidence?: number | null;
      investigationId?: string | null;
      evidenceId?: string | null;
      payload?: Prisma.InputJsonValue;
    },
  ) {
    return prisma.assetTimelineEvent.create({
      data: {
        assetId,
        eventType: event.eventType as never,
        title: event.title,
        detail: event.detail ?? null,
        platform: event.platform ?? null,
        url: event.url ?? null,
        similarity: event.similarity ?? null,
        tampered: event.tampered ?? null,
        riskScore: event.riskScore ?? null,
        confidence: event.confidence ?? null,
        investigationId: event.investigationId ?? null,
        evidenceId: event.evidenceId ?? null,
        payload: event.payload,
      },
    });
  }
}

export const assetService = new AssetService();
