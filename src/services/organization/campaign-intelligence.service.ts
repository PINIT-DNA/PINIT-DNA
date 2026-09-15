/**
 * Campaign Intelligence — one answer to "what is happening with our work?"
 *
 * Every number here is counted from a real row. Nothing is estimated, projected
 * or filled in for the sake of a complete-looking dashboard: where there is
 * nothing, the section says so and says why, because a confident zero and an
 * unanswerable question look identical on a tile and mean opposite things.
 *
 * No new storage. It reads what the earlier layers already built — versions,
 * approvals, comments, messages, people, rights, handovers, monitoring — plus
 * the pre-existing Incident and EvidenceRecord tables, and joins them by
 * campaign.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { getDiscoveryCapability } from './campaign-monitoring.service';

export const campaignIntelligenceService = {
  async getForCampaign(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId },
      select: {
        id: true, name: true, status: true, startDate: true, endDate: true,
        client: { select: { id: true, name: true } },
      },
    });
    if (!campaign) throw new AppError(404, 'Campaign not found');

    const assets = await prisma.asset.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, originalFilename: true, assetType: true, createdAt: true,
        dnaId: true, vaultId: true, certificateId: true,
      },
    });
    const assetIds = assets.map((a) => a.id);
    const dnaIds = assets.map((a) => a.dnaId).filter((d): d is string => Boolean(d));

    // Everything below is a count of real rows.
    const [
      versions, approvals, comments, messages, members, memberAssets,
      handovers, discoveries, monitors, incidents, shareLinks, activity, capability,
    ] = await Promise.all([
      assetIds.length
        ? prisma.assetVersion.findMany({
            where: { assetId: { in: assetIds } },
            select: { id: true, assetId: true, versionNumber: true, reviewStatus: true,
                      supersededAt: true, createdAt: true },
          })
        : Promise.resolve([]),
      assetIds.length
        ? prisma.versionApproval.findMany({
            where: { assetId: { in: assetIds } },
            select: { id: true, decision: true, approverLabel: true, createdAt: true,
                      approvedByRecipientId: true },
          })
        : Promise.resolve([]),
      prisma.reviewComment.findMany({
        where: { campaignId },
        select: { id: true, kind: true, status: true, authorRecipientId: true, createdAt: true },
      }),
      prisma.campaignMessage.findMany({
        where: { campaignId },
        select: { id: true, authorRecipientId: true, isSystem: true, createdAt: true,
                  readByTeamAt: true },
      }),
      prisma.campaignMember.findMany({
        where: { campaignId },
        select: { id: true, name: true, isExternal: true, accessStatus: true,
                  lastAccessAt: true, userId: true },
      }),
      prisma.campaignMemberAsset.findMany({
        where: { member: { campaignId } },
        select: { assetId: true, memberId: true },
      }),
      prisma.campaignHandover.findMany({
        where: { campaignId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, recipientLabel: true, sentAt: true,
                  firstOpenedAt: true, createdAt: true, assets: { select: { assetId: true } } },
      }),
      assetIds.length
        ? prisma.assetDiscovery.findMany({
            where: { assetId: { in: assetIds } },
            select: { id: true, assetId: true, alertStatus: true, severity: true,
                      similarity: true, riskScore: true, url: true, createdAt: true,
                      investigationId: true },
          })
        : Promise.resolve([]),
      dnaIds.length
        ? prisma.monitorRecord.findMany({
            where: { dnaRecordId: { in: dnaIds } },
            select: { dnaRecordId: true, status: true, lastCheckedAt: true, totalChecks: true },
          })
        : Promise.resolve([]),
      // Investigations already exist, keyed by DNA record.
      dnaIds.length
        ? prisma.incident.findMany({
            where: { dnaRecordId: { in: dnaIds } },
            select: { id: true, incidentCode: true, severity: true, status: true,
                      triggerType: true, createdAt: true, resolvedAt: true,
                      _count: { select: { evidenceRecords: true } } },
          })
        : Promise.resolve([]),
      assetIds.length
        ? prisma.shareLink.findMany({
            where: { assetId: { in: assetIds } },
            select: { assetId: true, isActive: true, viewCount: true, reviewMode: true },
          })
        : Promise.resolve([]),
      prisma.organizationAuditLog.findMany({
        where: { organizationId, entityType: 'campaign', entityId: campaignId },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { id: true, action: true, title: true, createdAt: true },
      }),
      getDiscoveryCapability(),
    ]);

    const monitorByDna = new Map(monitors.map((m) => [m.dnaRecordId, m]));
    const currentVersion = (assetId: string) => {
      const chain = versions.filter((v) => v.assetId === assetId);
      return chain.find((v) => !v.supersededAt) ?? chain[0] ?? null;
    };

    const handedOverAssetIds = new Set(
      handovers.filter((h) => h.status !== 'REVOKED')
        .flatMap((h) => h.assets.map((a) => a.assetId)),
    );

    const externals = members.filter((m) => m.isExternal);
    const clientComments = comments.filter((c) => c.authorRecipientId);
    const clientMessages = messages.filter((m) => m.authorRecipientId);
    const openChangeRequests = comments.filter(
      (c) => c.kind === 'CHANGE_REQUEST' && (c.status === 'OPEN' || c.status === 'IN_PROGRESS'),
    );

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        clientName: campaign.client?.name ?? null,
        startDate: campaign.startDate?.toISOString() ?? null,
        endDate: campaign.endDate?.toISOString() ?? null,
      },

      protection: {
        assets: assets.length,
        withDna: assets.filter((a) => a.dnaId).length,
        withVault: assets.filter((a) => a.vaultId).length,
        withCertificate: assets.filter((a) => a.certificateId).length,
      },

      review: {
        versions: versions.length,
        approved: versions.filter((v) => v.reviewStatus === 'APPROVED').length,
        inReview: versions.filter((v) => v.reviewStatus === 'IN_REVIEW').length,
        changesRequested: versions.filter((v) => v.reviewStatus === 'CHANGES_REQUESTED').length,
        draft: versions.filter((v) => v.reviewStatus === 'DRAFT').length,
        superseded: versions.filter((v) => v.supersededAt).length,
        openChangeRequests: openChangeRequests.length,
        totalComments: comments.length,
      },

      client: {
        name: campaign.client?.name ?? null,
        approvalsGiven: approvals.filter(
          (a) => a.decision === 'APPROVED' && a.approvedByRecipientId).length,
        changesRequested: approvals.filter(
          (a) => a.decision === 'CHANGES_REQUESTED' && a.approvedByRecipientId).length,
        commentsWritten: clientComments.length,
        messagesSent: clientMessages.length,
        unreadFromClient: messages.filter((m) => m.authorRecipientId && !m.readByTeamAt).length,
        lastHeardFrom: [...clientComments, ...clientMessages]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
          ?.createdAt.toISOString() ?? null,
      },

      creators: {
        total: externals.length,
        withAccess: externals.filter((m) => m.accessStatus === 'ACTIVE').length,
        revoked: externals.filter((m) => m.accessStatus === 'REVOKED').length,
        neverGranted: externals.filter((m) => m.accessStatus === 'NONE').length,
        assetsShared: new Set(memberAssets.map((m) => m.assetId)).size,
        people: externals.map((m) => ({
          name: m.name ?? 'Unnamed',
          accessStatus: m.accessStatus,
          assetCount: memberAssets.filter((ma) => ma.memberId === m.id).length,
          lastAccessAt: m.lastAccessAt?.toISOString() ?? null,
        })),
      },

      monitoring: {
        /** Whether discovery can actually find anything — carried through so the
         *  findings figures below can be read correctly. */
        capability: {
          crawlerEnabled: capability.crawlerEnabled,
          anyProviderOperational: capability.anyProviderOperational,
          summary: capability.summary,
          lastMatchAt: capability.lastMatchAt,
        },
        monitored: assets.filter((a) => a.dnaId && monitorByDna.get(a.dnaId)?.status === 'ACTIVE').length,
        monitorable: assets.filter((a) => a.dnaId).length,
        lastScanAt: monitors
          .map((m) => m.lastCheckedAt)
          .filter((d): d is Date => Boolean(d))
          .sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null,
        totalScans: monitors.reduce((n, m) => n + m.totalChecks, 0),
      },

      findings: {
        total: discoveries.length,
        needsReview: discoveries.filter((d) => d.alertStatus === 'PENDING').length,
        confirmed: discoveries.filter((d) => d.alertStatus === 'CONFIRMED').length,
        dismissed: discoveries.filter((d) => d.alertStatus === 'DISMISSED').length,
        /** High priority is a real property of the row, not a guess. */
        highPriority: discoveries.filter(
          (d) => d.alertStatus === 'PENDING'
            && (d.severity === 'HIGH' || d.severity === 'CRITICAL' || d.similarity >= 0.95)).length,
      },

      investigations: {
        total: incidents.length,
        open: incidents.filter((i) => !i.resolvedAt).length,
        resolved: incidents.filter((i) => i.resolvedAt).length,
        evidenceItems: incidents.reduce((n, i) => n + i._count.evidenceRecords, 0),
        recent: incidents.slice(0, 5).map((i) => ({
          code: i.incidentCode,
          severity: i.severity,
          status: i.status,
          trigger: i.triggerType,
          openedAt: i.createdAt.toISOString(),
          resolvedAt: i.resolvedAt?.toISOString() ?? null,
          evidenceCount: i._count.evidenceRecords,
        })),
      },

      handover: {
        total: handovers.length,
        completed: handovers.filter((h) => h.status === 'COMPLETED').length,
        awaitingClient: handovers.filter((h) => h.status === 'READY').length,
        draft: handovers.filter((h) => h.status === 'DRAFT').length,
        revoked: handovers.filter((h) => h.status === 'REVOKED').length,
        assetsDelivered: handedOverAssetIds.size,
        latest: handovers[0]
          ? {
              status: handovers[0].status,
              recipientLabel: handovers[0].recipientLabel,
              sentAt: handovers[0].sentAt?.toISOString() ?? null,
              openedAt: handovers[0].firstOpenedAt?.toISOString() ?? null,
            }
          : null,
      },

      sharing: {
        links: shareLinks.length,
        active: shareLinks.filter((l) => l.isActive).length,
        reviewLinks: shareLinks.filter((l) => l.reviewMode).length,
        totalViews: shareLinks.reduce((n, l) => n + l.viewCount, 0),
      },

      /**
       * One row per asset, tying together everything that touches it.
       *
       * This is the relationship view: version, approval, who can reach it,
       * whether it is watched, whether anything was found, whether it shipped.
       */
      assets: assets.map((a) => {
        const v = currentVersion(a.id);
        const found = discoveries.filter((d) => d.assetId === a.id);
        const reach = memberAssets.filter((ma) => ma.assetId === a.id).length;
        const monitor = a.dnaId ? monitorByDna.get(a.dnaId) : undefined;
        return {
          id: a.id,
          filename: a.originalFilename,
          assetType: a.assetType,
          protectedAt: a.createdAt.toISOString(),
          protection: {
            dna: Boolean(a.dnaId),
            vault: Boolean(a.vaultId),
            certificate: Boolean(a.certificateId),
          },
          version: v ? { number: v.versionNumber, status: v.reviewStatus } : null,
          versionCount: versions.filter((x) => x.assetId === a.id).length,
          creatorsWithAccess: reach,
          monitored: monitor?.status === 'ACTIVE',
          findings: found.length,
          findingsNeedingReview: found.filter((d) => d.alertStatus === 'PENDING').length,
          handedOver: handedOverAssetIds.has(a.id),
        };
      }),

      recentActivity: activity.map((e) => ({
        id: e.id,
        action: e.action,
        title: e.title,
        at: e.createdAt.toISOString(),
      })),
    };
  },
};
