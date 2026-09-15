/**
 * Universal Asset service — Asset-first protection layer.
 * Reuses Vault / DNA / Certificate / Monitoring / Publish Guardian — no duplicated forensics.
 */

import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
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

  /**
   * Attach the video / document adapter fingerprints to an Asset.
   *
   * The image layers (perceptual, structural, stego …) cannot run on an mp4 or a
   * PDF, so those media types have their own adapters. Publish Guardian already
   * calls them inline; the Hub upload path did not, which left `Asset.fingerprints`
   * null for every Hub-protected video and document.
   *
   * Reuses the existing adapters — no new protection system. Returns the stored
   * value, or null when the media type has no adapter or the adapter failed.
   */
  async attachMediaFingerprints(opts: {
    assetId: string;
    ownerUserId: string;
    buffer: Buffer;
    mimeType: string;
    originalFilename: string;
    dnaId?: string | null;
  }): Promise<Prisma.InputJsonValue | null> {
    const assetType = inferAssetType(opts.mimeType, opts.originalFilename);
    if (assetType !== 'VIDEO' && assetType !== 'DOCUMENT') return null;

    let fingerprints: Prisma.InputJsonValue;
    try {
      fingerprints = assetType === 'VIDEO'
        ? (await buildVideoAssetDna(opts.buffer)) as unknown as Prisma.InputJsonValue
        : (await buildDocumentAssetDna({
            buffer: opts.buffer,
            mimeType: opts.mimeType,
            originalFilename: opts.originalFilename,
            dnaRecordId: opts.dnaId ?? null,
          })) as unknown as Prisma.InputJsonValue;
    } catch (err) {
      // Record the failure rather than silently leaving the column null, so a
      // missing fingerprint is distinguishable from one that was never attempted.
      logger.warn('[Asset] media fingerprint generation failed', {
        assetId: opts.assetId,
        assetType,
        error: err instanceof Error ? err.message : String(err),
      });
      fingerprints = {
        engine: assetType === 'VIDEO' ? 'video' : 'document',
        error: 'generation_failed',
      } as unknown as Prisma.InputJsonValue;
    }

    // Scoped to the owner like every other asset write.
    await prisma.asset.updateMany({
      where: { id: opts.assetId, ownerUserId: opts.ownerUserId },
      data: { fingerprints },
    });

    return fingerprints;
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

  /**
   * Associate one of many platform URLs with an Asset.
   * Viewing a URL is never enough — only call after protect / late-bind publish.
   */
  /**
   * Give every protected file of this owner its canonical Asset identity.
   *
   * Files protected before Vault started creating an Asset row have only a
   * VaultRecord and a DnaRecord, so nothing can hang off them: Credentials
   * cannot offer "View protected asset", and Exchange refuses the listing with
   * "contact support to backfill it". The user is left carrying a gap the
   * system can close by itself.
   *
   * Nothing is invented here. Every field is read off records that already
   * exist, and the clientRequestId is the same `hub:<dnaId>` key the live
   * protect path writes — so ensureAssetFromProtect's existing lookup makes a
   * re-run a no-op rather than a second Asset.
   */
  async ensureAssetIdentityForOwner(ownerUserId: string): Promise<{
    created: number;
    alreadyLinked: number;
    skipped: number;
  }> {
    const vaults = await prisma.vaultRecord.findMany({
      where: { dnaRecord: { ownerUserId } },
      select: {
        id: true,
        dnaRecordId: true,
        originalFileName: true,
        originalMimeType: true,
        originalSizeBytes: true,
        dnaRecord: { select: { sha256Hash: true } },
      },
    });
    if (!vaults.length) return { created: 0, alreadyLinked: 0, skipped: 0 };

    const linked = await prisma.asset.findMany({
      where: { ownerUserId, vaultId: { in: vaults.map((v) => v.id) } },
      select: { vaultId: true },
    });
    const hasAsset = new Set(linked.map((a) => a.vaultId));

    let created = 0;
    let skipped = 0;
    for (const vault of vaults) {
      if (hasAsset.has(vault.id)) continue;
      try {
        await this.ensureAssetFromProtect({
          ownerUserId,
          assetType: inferAssetType(vault.originalMimeType, vault.originalFileName),
          originalFilename: vault.originalFileName,
          mimeType: vault.originalMimeType,
          sizeBytes: vault.originalSizeBytes,
          contentHash: vault.dnaRecord?.sha256Hash || '',
          vaultId: vault.id,
          dnaId: vault.dnaRecordId,
          certificateId: null,
          monitorRecordId: null,
          monitorStatus: 'PENDING',
          sourcePlatform: 'hub',
          sourceUrl: null,
          capturedVia: 'hub_protect_file',
          clientRequestId: `hub:${vault.dnaRecordId}`,
          status: ASSET_STATUS.PROTECTED,
          protectedPostId: '',
        });
        created += 1;
      } catch (err) {
        // A file that cannot be given an identity stays as it is. Vault and DNA
        // remain the source of truth, so this degrades rather than breaks.
        skipped += 1;
        logger.warn('Asset identity backfill skipped a vault record', {
          vaultId: vault.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { created, alreadyLinked: hasAsset.size, skipped };
  }

  async upsertPlatformLink(opts: {
    assetId: string;
    platform: string;
    url?: string | null;
    platformPostId?: string | null;
    uploadMethod?: string | null;
    isOriginal?: boolean;
    role?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const url = (opts.url || '').trim();
    if (!url) return null;
    const platform = String(opts.platform || 'web').toLowerCase();

    return prisma.assetPlatformLink.upsert({
      where: {
        assetId_platform_url: {
          assetId: opts.assetId,
          platform,
          url,
        },
      },
      create: {
        assetId: opts.assetId,
        platform,
        url,
        platformPostId: opts.platformPostId ?? null,
        uploadMethod: opts.uploadMethod ?? null,
        isOriginal: !!opts.isOriginal,
        role: opts.role || (opts.isOriginal ? 'original' : 'published'),
        metadata: opts.metadata,
      },
      update: {
        platformPostId: opts.platformPostId ?? undefined,
        uploadMethod: opts.uploadMethod ?? undefined,
        isOriginal: opts.isOriginal === true ? true : undefined,
        role: opts.role ?? undefined,
        metadata: opts.metadata ?? undefined,
      },
    });
  }

  /**
   * List an owner's assets, optionally by what they belong to rather than what
   * they are called.
   *
   * "Show me the campaign assets for this brand" is a question the data can
   * already answer — Asset.campaignId reaches Campaign, and Campaign.clientId
   * reaches the client the work was made for. Only filename and type were
   * exposed before, so answering it meant remembering a filename. Nothing new
   * is stored to support this; it reads relations that already exist.
   */
  async list(ownerUserId: string, opts?: {
    assetType?: string;
    status?: string;
    limit?: number;
    campaignId?: string;
    clientId?: string;
    hasCampaign?: boolean;
  }) {
    const take = Math.min(opts?.limit ?? 50, 100);

    // clientId filters through the campaign relation; a campaign always has a
    // client, so an asset with no campaign can never match one.
    const campaignScope =
      opts?.campaignId ? { campaignId: opts.campaignId }
      : opts?.clientId ? { campaign: { is: { clientId: opts.clientId } } }
      : opts?.hasCampaign === true ? { campaignId: { not: null } }
      : opts?.hasCampaign === false ? { campaignId: null }
      : {};

    return prisma.asset.findMany({
      where: {
        ownerUserId,
        ...(opts?.assetType ? { assetType: opts.assetType as never } : {}),
        ...(opts?.status ? { status: opts.status as never } : {}),
        ...campaignScope,
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        // The campaign and the client it was made for, so a listing can say what
        // an asset belongs to instead of only what it is called.
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            client: { select: { id: true, name: true } },
          },
        },
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
        platformLinks: { orderBy: [{ isOriginal: 'desc' }, { createdAt: 'asc' }] },
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
        /*
         * Context, ownership and lineage were all reachable from Asset and none
         * of them were loaded, so the asset view could only describe the file
         * itself — type, size, and truncated identifiers. These say what the
         * asset belongs to, who holds it, and what came before it.
         */
        campaign: {
          select: {
            id: true,
            name: true,
            status: true,
            client: { select: { id: true, name: true } },
            organization: { select: { id: true, name: true } },
          },
        },
        ownerUser: { select: { id: true, fullName: true, shortId: true } },
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 20,
          select: {
            id: true,
            versionNumber: true,
            originalFilename: true,
            createdAt: true,
            certificateId: true,
          },
        },
      },
    });
    if (!asset) throw new AppError(404, 'Asset not found');
    return asset;
  }

  /**
   * The asset's real connections, in one shape.
   *
   * Every edge here already exists in the database — owner, campaign and the
   * client it was made for, earlier versions, the platforms it was published
   * to, where it has been discovered, and the evidence collected against its
   * DNA. What did not exist was anywhere that assembled them, so answering
   * "what is this asset connected to?" meant visiting six screens.
   *
   * A group is omitted entirely when it has no members. An empty section is a
   * worse answer than no section, and it invites the reader to assume the
   * system looked and found nothing when it simply has nothing to show.
   */
  async getRelationshipGraph(ownerUserId: string, assetId: string) {
    const asset = await prisma.asset.findFirst({
      where: { id: assetId, ownerUserId },
      include: {
        ownerUser: { select: { id: true, fullName: true, shortId: true } },
        campaign: {
          select: {
            id: true, name: true, status: true,
            client: { select: { id: true, name: true } },
            organization: { select: { id: true, name: true } },
          },
        },
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 20,
          select: { id: true, versionNumber: true, originalFilename: true, createdAt: true },
        },
        platformLinks: {
          orderBy: [{ isOriginal: 'desc' }, { createdAt: 'asc' }],
          take: 25,
        },
        discoveries: { orderBy: { lastSeen: 'desc' }, take: 25 },
        protectedPosts: {
          select: { id: true, platform: true, postUrl: true, status: true },
          take: 25,
        },
      },
    });
    if (!asset) throw new AppError(404, 'Asset not found');

    // Evidence hangs off the DNA record rather than the asset, so it is only
    // reachable once this asset actually has DNA.
    const evidence = asset.dnaId
      ? await prisma.evidenceRecord.findMany({
          where: { dnaRecordId: asset.dnaId, ownerUserId },
          orderBy: { collectedAt: 'desc' },
          take: 25,
          select: {
            id: true, evidenceCode: true, evidenceType: true,
            description: true, collectedAt: true,
          },
        })
      : [];

    type Node = { id: string; label: string; sub?: string; href?: string };
    const groups: Array<{ kind: string; label: string; items: Node[] }> = [];
    const add = (kind: string, label: string, items: Node[]) => {
      if (items.length) groups.push({ kind, label, items });
    };

    add('OWNER', 'Owner', asset.ownerUser ? [{
      id: asset.ownerUser.id,
      label: asset.ownerUser.fullName || asset.ownerUser.shortId || 'Owner',
      sub: asset.ownerUser.shortId || undefined,
    }] : []);

    add('CAMPAIGN', 'Campaign', asset.campaign ? [{
      id: asset.campaign.id,
      label: asset.campaign.name,
      sub: asset.campaign.status,
      href: `/business/clients`,
    }] : []);

    add('CLIENT', 'Client', asset.campaign?.client ? [{
      id: asset.campaign.client.id,
      label: asset.campaign.client.name,
      href: `/business/clients`,
    }] : []);

    add('ORGANIZATION', 'Organisation', asset.campaign?.organization ? [{
      id: asset.campaign.organization.id,
      label: asset.campaign.organization.name || 'Organisation',
    }] : []);

    add('VERSION', 'Versions', asset.versions.map((v) => ({
      id: v.id,
      label: v.originalFilename,
      sub: `v${v.versionNumber}`,
    })));

    add('PLATFORM', 'Published to', asset.platformLinks.map((l) => ({
      id: l.id,
      label: l.platform,
      sub: l.isOriginal ? 'original' : undefined,
      href: l.url || undefined,
    })));

    add('POST', 'Protected posts', asset.protectedPosts.map((p) => ({
      id: p.id,
      label: p.platform,
      sub: p.status,
      href: p.postUrl || undefined,
    })));

    add('DISCOVERY', 'Found elsewhere', asset.discoveries.map((d) => ({
      id: d.id,
      label: d.platform || 'Discovery',
      sub: d.url || undefined,
      href: d.url || undefined,
    })));

    add('EVIDENCE', 'Evidence', evidence.map((e) => ({
      id: e.id,
      label: e.evidenceType,
      sub: e.description,
    })));

    return {
      asset: {
        id: asset.id,
        title: asset.originalFilename,
        assetType: asset.assetType,
        status: asset.status,
      },
      groups,
      totalConnections: groups.reduce((n, g) => n + g.items.length, 0),
    };
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
    ownerUserId: string;
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
        ownerUserId: opts.ownerUserId,
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
