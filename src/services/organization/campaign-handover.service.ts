/**
 * Handing finished work to the client.
 *
 * A handover is an event with a record: who received what, when they opened it,
 * and under whose authority it was sent. The assets are referenced, never
 * copied and never re-protected — their DNA records, vault entries and
 * certificates are exactly what they were before.
 *
 * Access is a scoped ShareLink per asset plus one bundle token, so revocation,
 * expiry and tracking come from the sharing layer rather than a new mechanism.
 *
 * The rule that shapes everything: only an APPROVED version can be handed over
 * as final. A handover is the team saying "this is finished", and a version
 * nobody signed off is not finished.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import { shareLinkService } from '../share/share-link.service';
import { platformEvents } from '../platform-events';

function newToken(): string {
  // Distinct prefix so a handover token is never mistaken for a share token.
  return `HO${crypto.randomBytes(9).toString('base64url')}`;
}

async function loadHandoverScoped(organizationId: string, campaignId: string, handoverId: string) {
  const handover = await prisma.campaignHandover.findFirst({
    where: { id: handoverId, campaignId, organizationId },
    include: { assets: true },
  });
  if (!handover) throw new AppError(404, 'Handover not found');
  return handover;
}

export const campaignHandoverService = {
  /**
   * Which assets are eligible to hand over.
   *
   * Returns everything with its reason, rather than silently hiding what does
   * not qualify — "why can I not send this one" is the first question someone
   * asks, and an absent row cannot answer it.
   */
  async listCandidates(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId },
      select: { id: true, name: true, client: { select: { id: true, name: true, contactName: true } } },
    });
    if (!campaign) throw new AppError(404, 'Campaign not found');

    const assets = await prisma.asset.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, originalFilename: true, vaultId: true },
    });

    const versions = await prisma.assetVersion.findMany({
      where: { assetId: { in: assets.map((a) => a.id) } },
      orderBy: { versionNumber: 'desc' },
    });

    return {
      campaignName: campaign.name,
      client: campaign.client
        ? { id: campaign.client.id, name: campaign.client.name, contactName: campaign.client.contactName }
        : null,
      candidates: assets.map((a) => {
        const chain = versions.filter((v) => v.assetId === a.id);
        const approved = chain.find((v) => v.reviewStatus === 'APPROVED');
        const current = chain.find((v) => !v.supersededAt) ?? chain[0] ?? null;
        return {
          assetId: a.id,
          filename: a.originalFilename,
          eligible: Boolean(approved && a.vaultId),
          versionId: approved?.id ?? null,
          versionNumber: approved?.versionNumber ?? null,
          reason: approved
            ? (a.vaultId ? null : 'This file is not in the vault yet.')
            : current
              ? `Version ${current.versionNumber} is ${current.reviewStatus.replace(/_/g, ' ').toLowerCase()} — only an approved version can be handed over.`
              : 'No version has been created yet.',
        };
      }),
    };
  },

  /** Handovers for a campaign, newest first. */
  async list(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const rows = await prisma.campaignHandover.findMany({
      where: { campaignId, organizationId },
      include: { assets: true },
      orderBy: { createdAt: 'desc' },
    });

    const assetIds = [...new Set(rows.flatMap((h) => h.assets.map((a) => a.assetId)))];
    const assets = assetIds.length
      ? await prisma.asset.findMany({ where: { id: { in: assetIds } },
          select: { id: true, originalFilename: true } })
      : [];
    const nameById = new Map(assets.map((a) => [a.id, a.originalFilename]));

    return rows.map((h) => ({
      id: h.id,
      status: h.status,
      title: h.title,
      note: h.note,
      recipientLabel: h.recipientLabel,
      recipientEmail: h.recipientEmail,
      accessToken: h.accessToken,
      createdAt: h.createdAt.toISOString(),
      sentAt: h.sentAt ? h.sentAt.toISOString() : null,
      firstOpenedAt: h.firstOpenedAt ? h.firstOpenedAt.toISOString() : null,
      completedAt: h.completedAt ? h.completedAt.toISOString() : null,
      revokedAt: h.revokedAt ? h.revokedAt.toISOString() : null,
      expiresAt: h.expiresAt ? h.expiresAt.toISOString() : null,
      openCount: h.openCount,
      assets: h.assets.map((a) => ({
        assetId: a.assetId,
        filename: nameById.get(a.assetId) ?? 'Removed asset',
        versionId: a.versionId,
        hasLink: Boolean(a.shareToken),
      })),
    }));
  },

  /**
   * Assemble a handover and issue its access.
   *
   * Every asset is checked twice over: it must belong to THIS campaign, and the
   * version named must be an APPROVED version of that same asset. Trusting a
   * caller-supplied versionId without the second check would let an approved
   * version of one asset be attached to another.
   */
  async create(
    organizationId: string,
    actorUserId: string,
    campaignId: string,
    input: {
      assetIds?: string[];
      title?: string;
      note?: string;
      recipientLabel?: string;
      recipientEmail?: string;
      expiresInHours?: number | null;
      allowDownload?: boolean;
    },
  ) {
    // Handing work to a client is a manager-level act.
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId },
      select: { id: true, name: true, clientId: true,
                client: { select: { name: true, contactName: true, contactEmail: true } } },
    });
    if (!campaign) throw new AppError(404, 'Campaign not found');

    const assetIds = [...new Set(input.assetIds ?? [])];
    if (assetIds.length === 0) throw new AppError(400, 'Choose at least one approved asset to hand over');

    // Scope check: these assets must be in this campaign.
    const assets = await prisma.asset.findMany({
      where: { id: { in: assetIds }, campaignId },
      select: { id: true, originalFilename: true, vaultId: true, ownerUserId: true },
    });
    if (assets.length !== assetIds.length) {
      throw new AppError(400, 'One or more of those assets is not part of this campaign');
    }

    // Finality check: each must have an APPROVED version, and it must be a
    // version OF THAT ASSET.
    const approved = await prisma.assetVersion.findMany({
      where: { assetId: { in: assetIds }, reviewStatus: 'APPROVED', organizationId },
      orderBy: { versionNumber: 'desc' },
    });
    const approvedByAsset = new Map<string, (typeof approved)[number]>();
    for (const v of approved) if (!approvedByAsset.has(v.assetId)) approvedByAsset.set(v.assetId, v);

    const missing = assets.filter((a) => !approvedByAsset.has(a.id));
    if (missing.length) {
      throw new AppError(
        400,
        `Not approved yet: ${missing.map((m) => m.originalFilename).join(', ')}. `
        + 'Only an approved version can be handed over as final.',
      );
    }

    const recipientLabel = input.recipientLabel?.trim()
      || campaign.client?.contactName
      || campaign.client?.name
      || 'Client';

    // One recipient identity for the handover, so opens accumulate against it.
    const recipient = await prisma.shareRecipient.create({
      data: {
        ownerUserId: actorUserId,
        label: recipientLabel,
        recipientCode: `HO-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      },
    });

    const expiresAt = input.expiresInHours
      ? new Date(Date.now() + input.expiresInHours * 3_600_000)
      : null;

    const handover = await prisma.campaignHandover.create({
      data: {
        organizationId,
        campaignId,
        clientId: campaign.clientId,
        status: 'DRAFT',
        title: input.title?.trim() || `${campaign.name} — final assets`,
        note: input.note?.trim() || null,
        recipientLabel,
        recipientEmail: input.recipientEmail?.trim() || campaign.client?.contactEmail || null,
        shareRecipientId: recipient.id,
        accessToken: newToken(),
        expiresAt,
        createdByUserId: actorUserId,
      },
    });

    // Issue one scoped link per asset, pinned to the approved version.
    for (const asset of assets) {
      const version = approvedByAsset.get(asset.id)!;
      let shareToken: string | null = null;

      if (asset.vaultId) {
        const link = await shareLinkService.create({
          vaultId: asset.vaultId,
          ownerUserId: asset.ownerUserId,
          assetId: asset.id,
          recipientLabel,
          shareRecipientId: recipient.id,
          allowDownload: input.allowDownload ?? true,
          reviewMode: true,
          // A handover is delivery, not another review round. The client can
          // see what was approved; they are not being asked to decide again.
          allowComments: false,
          allowChangeRequest: false,
          allowApproval: false,
          reviewVersionId: version.id,
          ...(input.expiresInHours ? { expiresIn: input.expiresInHours } : {}),
        } as Parameters<typeof shareLinkService.create>[0]);
        shareToken = link.token;
      }

      await prisma.campaignHandoverAsset.create({
        data: { handoverId: handover.id, assetId: asset.id, versionId: version.id, shareToken },
      });
    }

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'HANDOVER_CREATED',
      entityType: 'campaign', entityId: campaignId,
      title: `Handover prepared for ${recipientLabel} — ${assets.length} final asset${assets.length === 1 ? '' : 's'}`,
      detail: { handoverId: handover.id, assetIds },
    });

    return this.get(organizationId, actorUserId, campaignId, handover.id);
  },

  /** Move a prepared handover to READY, which is what makes it openable. */
  async send(organizationId: string, actorUserId: string, campaignId: string, handoverId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const handover = await loadHandoverScoped(organizationId, campaignId, handoverId);

    if (handover.status === 'REVOKED') {
      throw new AppError(409, 'This handover was revoked. Prepare a new one instead.');
    }
    if (handover.status !== 'DRAFT') return this.get(organizationId, actorUserId, campaignId, handoverId);

    await prisma.campaignHandover.update({
      where: { id: handoverId },
      data: { status: 'READY', sentAt: new Date() },
    });

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'HANDOVER_SENT',
      entityType: 'campaign', entityId: campaignId,
      title: `Handover sent to ${handover.recipientLabel}`,
      detail: { handoverId },
    });

    // Post it into the campaign conversation, so the thread reads as one story.
    const { campaignMessageService } = await import('./campaign-message.service');
    await campaignMessageService.postSystem(
      organizationId, campaignId,
      `Final assets were handed over to ${handover.recipientLabel}.`,
    );

    return this.get(organizationId, actorUserId, campaignId, handoverId);
  },

  /**
   * Withdraw a handover.
   *
   * Deactivates the underlying links so the client loses access immediately;
   * clearing our own rows alone would leave live links behind. The record of
   * the handover having happened stays.
   */
  async revoke(organizationId: string, actorUserId: string, campaignId: string, handoverId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const handover = await loadHandoverScoped(organizationId, campaignId, handoverId);

    const tokens = handover.assets.map((a) => a.shareToken).filter((t): t is string => Boolean(t));
    if (tokens.length) {
      await prisma.shareLink.updateMany({ where: { token: { in: tokens } }, data: { isActive: false } });
    }

    await prisma.campaignHandover.update({
      where: { id: handoverId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'HANDOVER_REVOKED',
      entityType: 'campaign', entityId: campaignId,
      title: `Handover to ${handover.recipientLabel} was revoked`,
      detail: { handoverId, revokedLinks: tokens.length },
    });

    return this.get(organizationId, actorUserId, campaignId, handoverId);
  },

  async get(organizationId: string, actorUserId: string, campaignId: string, handoverId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const all = await this.list(organizationId, actorUserId, campaignId);
    const one = all.find((h) => h.id === handoverId);
    if (!one) throw new AppError(404, 'Handover not found');
    return one;
  },

  /**
   * Record that the client opened it.
   *
   * COMPLETED is set from the client's own access rather than asserted by the
   * team, because "we sent it" and "they received it" are different facts and
   * only one of them is evidence.
   */
  async recordOpen(handoverId: string) {
    const handover = await prisma.campaignHandover.findUnique({
      where: { id: handoverId },
      select: { id: true, status: true, firstOpenedAt: true, organizationId: true,
                campaignId: true, recipientLabel: true },
    });
    if (!handover) return;

    const first = !handover.firstOpenedAt;
    await prisma.campaignHandover.update({
      where: { id: handoverId },
      data: {
        openCount: { increment: 1 },
        ...(first ? { firstOpenedAt: new Date() } : {}),
        ...(handover.status === 'READY' ? { status: 'COMPLETED', completedAt: new Date() } : {}),
      },
    });

    if (first) {
      await logOrgAudit({
        organizationId: handover.organizationId,
        actorUserId: null,
        action: 'HANDOVER_OPENED',
        entityType: 'campaign', entityId: handover.campaignId,
        title: `${handover.recipientLabel} opened the handover`,
        detail: { handoverId },
      });

      const owner = await prisma.campaign.findUnique({
        where: { id: handover.campaignId },
        select: { createdByUserId: true },
      });
      if (owner) {
        platformEvents.emit({
          name: 'handover.opened',
          category: 'sharing',
          severity: 'success',
          ownerUserId: owner.createdByUserId,
          entityType: 'campaign',
          entityId: handover.campaignId,
          title: `${handover.recipientLabel} opened the handover`,
          body: 'The final assets have been received.',
          deepLink: `/business/campaigns/${handover.campaignId}?tab=rights`,
          notificationType: 'HANDOVER_OPENED',
          skipTimeline: true,
          skipAudit: true,
        });
      }
    }
  },
};
