/**
 * Historical notification destinations.
 *
 * Newer policy events already store a campaign/entity URL. Older rows often
 * store a list-page path (`/monitoring`, `/investigation`, `/certificates`, …)
 * plus entityType/entityId. This module rewrites the destination when — and
 * only when — the referenced entity still exists and belongs to the viewer.
 *
 * It never:
 *   - invents an entity id
 *   - changes notificationClass (Activity stays Activity)
 *   - changes read / archived
 *   - creates a new notification row
 *   - deletes anything
 */
import { prisma } from '../../lib/prisma';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GENERIC_LIST_PATHS = new Set([
  '/monitoring',
  '/investigation',
  '/unified-investigation',
  '/certificates',
  '/dna',
  '/dna-records',
  '/vault',
  '/dashboard',
  '/access-intelligence',
  '/pinit-hub/investigation',
  '/profile?tab=notifications',
]);

export type HistoricalNotificationRow = {
  id: string;
  userId: string;
  type: string;
  category: string | null;
  deepLink: string | null;
  linkToken: string | null;
  entityType: string | null;
  entityId: string | null;
  notificationClass: string | null;
  read: boolean;
  archived: boolean;
};

export type LinkResolutionStatus = 'specific' | 'resolved' | 'unresolved' | 'generic-kept';

export type ResolvedNotificationLink = {
  deepLink: string | null;
  status: LinkResolutionStatus;
  reason: string;
};

export function pathOf(deepLink: string | null | undefined): string {
  if (!deepLink) return '';
  return deepLink.split('?')[0] || '';
}

export function isGenericListDeepLink(deepLink: string | null | undefined): boolean {
  if (!deepLink) return true;
  const trimmed = deepLink.trim();
  if (!trimmed) return true;
  if (GENERIC_LIST_PATHS.has(trimmed)) return true;
  const p = pathOf(trimmed);
  if (GENERIC_LIST_PATHS.has(p) && !trimmed.includes('id=') && !trimmed.includes('monitor=') && !trimmed.includes('tab=')) {
    return true;
  }
  return false;
}

function campaignUrl(campaignId: string, tab: string, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ tab, ...extra });
  return `/business/campaigns/${campaignId}?${q.toString()}`;
}

async function campaignAccess(userId: string, campaignId: string): Promise<{ exists: boolean; allowed: boolean }> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { organizationId: true },
  });
  if (!campaign) return { exists: false, allowed: false };
  const org = await prisma.organizationMember.findFirst({
    where: { userId, organizationId: campaign.organizationId },
    select: { id: true },
  });
  if (org) return { exists: true, allowed: true };
  const member = await prisma.campaignMember.findFirst({
    where: { campaignId, userId, revokedAt: null },
    select: { id: true },
  });
  return { exists: true, allowed: Boolean(member) };
}

async function fromCampaign(userId: string, campaignId: string | null | undefined, tab: string, extra?: Record<string, string>): Promise<ResolvedNotificationLink | null> {
  if (!campaignId) return null;
  const access = await campaignAccess(userId, campaignId);
  if (!access.exists) {
    return { deepLink: null, status: 'unresolved', reason: 'campaign-missing' };
  }
  if (!access.allowed) {
    return { deepLink: null, status: 'unresolved', reason: 'campaign-not-allowed' };
  }
  return {
    deepLink: campaignUrl(campaignId, tab, extra),
    status: 'resolved',
    reason: `campaign:${tab}`,
  };
}

async function resolveFromEntity(userId: string, entityType: string, entityId: string): Promise<ResolvedNotificationLink | null> {
  switch (entityType) {
    case 'campaign':
      return fromCampaign(userId, entityId, 'overview');

    case 'asset': {
      const asset = await prisma.asset.findUnique({
        where: { id: entityId },
        select: { campaignId: true, ownerUserId: true, vaultId: true },
      });
      if (!asset) return { deepLink: null, status: 'unresolved', reason: 'asset-missing' };
      const camp = await fromCampaign(userId, asset.campaignId, 'assets', { asset: entityId });
      if (camp?.deepLink) return camp;
      if (asset.ownerUserId === userId && asset.vaultId) {
        return { deepLink: `/vault?id=${asset.vaultId}`, status: 'resolved', reason: 'vault-asset' };
      }
      return { deepLink: null, status: 'unresolved', reason: 'asset-no-safe-destination' };
    }

    case 'version': {
      const version = await prisma.assetVersion.findUnique({
        where: { id: entityId },
        select: { campaignId: true, assetId: true },
      });
      if (!version) return { deepLink: null, status: 'unresolved', reason: 'version-missing' };
      let campaignId = version.campaignId;
      if (!campaignId) {
        const asset = await prisma.asset.findUnique({
          where: { id: version.assetId },
          select: { campaignId: true },
        });
        campaignId = asset?.campaignId ?? null;
      }
      return fromCampaign(userId, campaignId, 'approvals', {
        asset: version.assetId,
        version: entityId,
      });
    }

    case 'finding': {
      const finding = await prisma.assetDiscovery.findUnique({
        where: { id: entityId },
        select: { asset: { select: { campaignId: true } } },
      });
      if (!finding) return { deepLink: null, status: 'unresolved', reason: 'finding-missing' };
      return fromCampaign(userId, finding.asset.campaignId, 'findings', { finding: entityId });
    }

    case 'investigation': {
      const incident = await prisma.incident.findUnique({
        where: { id: entityId },
        select: { campaignId: true },
      });
      if (incident?.campaignId) {
        return fromCampaign(userId, incident.campaignId, 'investigations', { case: entityId });
      }
      // Forensic tool run, not a campaign case — do not invent a case URL.
      return {
        deepLink: '/pinit-hub/investigation',
        status: incident ? 'resolved' : 'resolved',
        reason: incident ? 'forensic-investigation-tool' : 'investigation-row-missing-tool-fallback',
      };
    }

    case 'handover': {
      const ho = await prisma.campaignHandover.findUnique({
        where: { id: entityId },
        select: { campaignId: true },
      });
      if (!ho) return { deepLink: null, status: 'unresolved', reason: 'handover-missing' };
      return fromCampaign(userId, ho.campaignId, 'handover', { handover: entityId });
    }

    case 'report': {
      const report = await prisma.clientReport.findUnique({
        where: { id: entityId },
        select: { campaignId: true, investigationId: true },
      });
      if (!report) return { deepLink: null, status: 'unresolved', reason: 'report-missing' };
      return fromCampaign(userId, report.campaignId, 'investigations', {
        case: report.investigationId,
        report: entityId,
      });
    }

    case 'monitor_record': {
      const monitor = await prisma.monitorRecord.findUnique({
        where: { id: entityId },
        select: { ownerUserId: true, assetId: true },
      });
      if (!monitor) return { deepLink: null, status: 'unresolved', reason: 'monitor-missing' };
      if (monitor.ownerUserId && monitor.ownerUserId !== userId) {
        return { deepLink: null, status: 'unresolved', reason: 'monitor-not-owner' };
      }
      if (monitor.assetId) {
        const asset = await prisma.asset.findUnique({
          where: { id: monitor.assetId },
          select: { campaignId: true, ownerUserId: true },
        });
        const camp = await fromCampaign(userId, asset?.campaignId, 'findings');
        if (camp?.deepLink) return camp;
      }
      if (!monitor.ownerUserId || monitor.ownerUserId === userId) {
        return { deepLink: `/monitoring?monitor=${entityId}`, status: 'resolved', reason: 'monitor-personal' };
      }
      return { deepLink: null, status: 'unresolved', reason: 'monitor-no-safe-destination' };
    }

    case 'vault': {
      const vault = await prisma.vaultRecord.findUnique({
        where: { id: entityId },
        select: { dnaRecord: { select: { ownerUserId: true } } },
      });
      if (!vault) return { deepLink: null, status: 'unresolved', reason: 'vault-missing' };
      if (vault.dnaRecord.ownerUserId && vault.dnaRecord.ownerUserId !== userId) {
        return { deepLink: null, status: 'unresolved', reason: 'vault-not-owner' };
      }
      return { deepLink: `/vault?id=${entityId}`, status: 'resolved', reason: 'vault' };
    }

    case 'dna_record': {
      const dna = await prisma.dnaRecord.findUnique({
        where: { id: entityId },
        select: { ownerUserId: true },
      });
      if (!dna) return { deepLink: null, status: 'unresolved', reason: 'dna-missing' };
      if (dna.ownerUserId && dna.ownerUserId !== userId) {
        return { deepLink: null, status: 'unresolved', reason: 'dna-not-owner' };
      }
      return { deepLink: `/dna-records?id=${entityId}`, status: 'resolved', reason: 'dna' };
    }

    case 'certificate': {
      const byPk = UUID_RE.test(entityId)
        ? await prisma.certificate.findUnique({
          where: { id: entityId },
          select: { id: true, certificateId: true, ownerUserId: true, vaultId: true },
        })
        : null;
      const cert = byPk ?? await prisma.certificate.findUnique({
        where: { certificateId: entityId },
        select: { id: true, certificateId: true, ownerUserId: true, vaultId: true },
      });
      if (!cert) return { deepLink: null, status: 'unresolved', reason: 'certificate-missing' };
      if (cert.ownerUserId && cert.ownerUserId !== userId) {
        return { deepLink: null, status: 'unresolved', reason: 'certificate-not-owner' };
      }
      return { deepLink: `/certificates?id=${encodeURIComponent(cert.certificateId)}`, status: 'resolved', reason: 'certificate' };
    }

    case 'share_link': {
      const share = await prisma.shareLink.findUnique({
        where: { id: entityId },
        select: { token: true, ownerUserId: true },
      });
      if (!share) return { deepLink: null, status: 'unresolved', reason: 'share-missing' };
      if (share.ownerUserId && share.ownerUserId !== userId) {
        return { deepLink: null, status: 'unresolved', reason: 'share-not-owner' };
      }
      return { deepLink: `/access-intelligence/${encodeURIComponent(share.token)}`, status: 'resolved', reason: 'share-link' };
    }

    case 'protected_post': {
      const post = await prisma.protectedPost.findUnique({
        where: { id: entityId },
        select: { vaultId: true, ownerUserId: true },
      });
      if (!post) return { deepLink: null, status: 'unresolved', reason: 'protected-post-missing' };
      if (post.ownerUserId && post.ownerUserId !== userId) {
        return { deepLink: null, status: 'unresolved', reason: 'protected-post-not-owner' };
      }
      if (!post.vaultId) {
        return { deepLink: null, status: 'unresolved', reason: 'protected-post-no-vault' };
      }
      return { deepLink: `/vault?id=${post.vaultId}`, status: 'resolved', reason: 'protected-post-vault' };
    }

    default:
      return null;
  }
}

/**
 * If the stored URL already names a campaign, confirm that campaign still
 * exists and the viewer may open it. Missing campaigns are reported, not
 * rewritten to a guessed replacement.
 */
async function validateStoredCampaignLink(userId: string, deepLink: string): Promise<ResolvedNotificationLink> {
  const path = pathOf(deepLink);
  const parts = path.split('/').filter(Boolean);
  const campaignId = parts[0] === 'business' && parts[1] === 'campaigns' ? parts[2] : undefined;
  if (!campaignId || !UUID_RE.test(campaignId)) {
    return { deepLink, status: 'specific', reason: 'already-specific' };
  }
  const access = await campaignAccess(userId, campaignId);
  if (!access.exists) {
    return { deepLink, status: 'unresolved', reason: 'stored-campaign-missing' };
  }
  if (!access.allowed) {
    return { deepLink, status: 'unresolved', reason: 'stored-campaign-not-allowed' };
  }
  return { deepLink, status: 'specific', reason: 'already-specific' };
}

export async function resolveNotificationDestination(
  row: HistoricalNotificationRow,
  viewerUserId: string = row.userId,
): Promise<ResolvedNotificationLink> {
  const stored = row.deepLink?.trim() || null;

  if (stored && !isGenericListDeepLink(stored)) {
    return validateStoredCampaignLink(viewerUserId, stored);
  }

  if (row.entityType && row.entityId) {
    const fromEntity = await resolveFromEntity(viewerUserId, row.entityType, row.entityId);
    if (fromEntity?.deepLink) return fromEntity;
    if (fromEntity?.status === 'unresolved' && !stored) return fromEntity;
    if (fromEntity?.status === 'unresolved' && stored) {
      return { deepLink: stored, status: 'unresolved', reason: fromEntity.reason };
    }
  }

  if (row.linkToken) {
    const share = await prisma.shareLink.findUnique({
      where: { token: row.linkToken },
      select: { ownerUserId: true, token: true },
    });
    if (share && (!share.ownerUserId || share.ownerUserId === viewerUserId)) {
      return {
        deepLink: `/access-intelligence/${encodeURIComponent(share.token)}`,
        status: 'resolved',
        reason: 'link-token',
      };
    }
  }

  // Dead Hub path that never existed as a route.
  if (stored === '/investigation' || stored === '/unified-investigation') {
    return { deepLink: '/pinit-hub/investigation', status: 'resolved', reason: 'legacy-investigation-path' };
  }
  if (stored === '/dna') {
    return { deepLink: '/dna-records', status: 'resolved', reason: 'legacy-dna-path' };
  }
  if (stored?.startsWith('/protected-posts/')) {
    return { deepLink: '/vault', status: 'resolved', reason: 'retired-protected-posts-route' };
  }

  if (stored) {
    return { deepLink: stored, status: 'generic-kept', reason: 'no-safe-entity' };
  }
  return { deepLink: null, status: 'unresolved', reason: 'empty' };
}

export async function applyResolvedDeepLinks<T extends HistoricalNotificationRow>(
  rows: T[],
  viewerUserId: string,
): Promise<{ rows: Array<T & { deepLink: string | null; linkResolution: LinkResolutionStatus }>; repairs: Array<{ id: string; deepLink: string }> }> {
  const repairs: Array<{ id: string; deepLink: string }> = [];
  const out: Array<T & { deepLink: string | null; linkResolution: LinkResolutionStatus }> = [];

  for (const row of rows) {
    const resolved = await resolveNotificationDestination(row, viewerUserId);
    const nextLink = resolved.deepLink ?? row.deepLink;
    out.push({ ...row, deepLink: nextLink, linkResolution: resolved.status });
    if (
      resolved.status === 'resolved'
      && resolved.deepLink
      && resolved.deepLink !== (row.deepLink ?? '')
    ) {
      repairs.push({ id: row.id, deepLink: resolved.deepLink });
    }
  }

  return { rows: out, repairs };
}

/** Persist destination only. Never touches class, read, or archived. */
export async function persistDeepLinkRepairs(
  userId: string,
  repairs: Array<{ id: string; deepLink: string }>,
): Promise<number> {
  let n = 0;
  for (const r of repairs) {
    const result = await prisma.notification.updateMany({
      where: { id: r.id, userId },
      data: { deepLink: r.deepLink },
    });
    n += result.count;
  }
  return n;
}
