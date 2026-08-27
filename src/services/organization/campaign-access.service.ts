/**
 * Scoped access for the people on a campaign.
 *
 * The rule this file exists to enforce: being listed on a campaign is a record
 * of involvement, not a grant. An external creator starts at NONE and reaches
 * exactly the assets someone deliberately assigns them — never the campaign,
 * never the Business Account, never the other eleven files.
 *
 * Access is issued as a ShareLink per assigned asset rather than as a new
 * permission system. That is not laziness: it means expiry, revocation,
 * view tracking, device and country restriction, watermarking and OTP already
 * apply to a creator's access, and there is no second system to keep in step
 * with the first.
 *
 * Internal staff are not governed here at all. Their rights come from
 * OrganizationMember and their org role, exactly as before.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import { emitBusinessEvent } from '../platform-events/notification-policy';
import { shareLinkService } from '../share/share-link.service';

export interface AccessGrant {
  canComment?: boolean;
  canRequestChanges?: boolean;
  canApprove?: boolean;
  /** Hours until the issued links expire. Null means no expiry. */
  expiresInHours?: number | null;
}

async function loadMemberScoped(organizationId: string, campaignId: string, memberId: string) {
  const member = await prisma.campaignMember.findFirst({
    where: { id: memberId, campaignId, campaign: { organizationId } },
    include: { assetAccess: true },
  });
  if (!member) throw new AppError(404, 'That person is not on this campaign');
  return member;
}

export const campaignAccessService = {
  /**
   * People on a campaign, with what each can actually reach.
   *
   * Internal members are resolved through OrganizationMember so their real
   * org role shows, rather than a copy of it stored on the campaign row that
   * could drift.
   */
  async listPeople(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);

    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId },
      select: { id: true, clientId: true, client: { select: { name: true, contactName: true, contactEmail: true } } },
    });
    if (!campaign) throw new AppError(404, 'Campaign not found');

    const members = await prisma.campaignMember.findMany({
      where: { campaignId },
      include: { assetAccess: true },
      orderBy: { createdAt: 'asc' },
    });

    const internalIds = members.filter((m) => m.userId).map((m) => m.userId!);
    const [users, orgRoles] = await Promise.all([
      internalIds.length
        ? prisma.user.findMany({ where: { id: { in: internalIds } },
            select: { id: true, fullName: true, shortId: true } })
        : Promise.resolve([]),
      internalIds.length
        ? prisma.organizationMember.findMany({
            where: { organizationId, userId: { in: internalIds } },
            select: { userId: true, role: true } })
        : Promise.resolve([]),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const roleByUser = new Map(orgRoles.map((r) => [r.userId, r.role]));

    const assetIds = [...new Set(members.flatMap((m) => m.assetAccess.map((a) => a.assetId)))];
    const assets = assetIds.length
      ? await prisma.asset.findMany({ where: { id: { in: assetIds } },
          select: { id: true, originalFilename: true } })
      : [];
    const assetById = new Map(assets.map((a) => [a.id, a]));

    const people = members.map((m) => {
      const user = m.userId ? userById.get(m.userId) : null;
      return {
        id: m.id,
        kind: m.isExternal ? ('external' as const) : ('internal' as const),
        name: user?.fullName || m.name || user?.shortId || 'Unnamed',
        shortId: user?.shortId ?? null,
        email: m.email,
        platform: m.platform,
        profileUrl: m.profileUrl,
        roleLabel: m.roleLabel,
        // Internal people show their organization role; external people show
        // the access they were granted.
        orgRole: m.userId ? (roleByUser.get(m.userId) ?? null) : null,
        accessStatus: m.isExternal ? m.accessStatus : ('ACTIVE' as const),
        permissions: m.isExternal
          ? { canComment: m.canComment, canRequestChanges: m.canRequestChanges, canApprove: m.canApprove }
          : null,
        assets: m.assetAccess.map((a) => ({
          assetId: a.assetId,
          filename: assetById.get(a.assetId)?.originalFilename ?? 'Removed asset',
          hasLink: Boolean(a.shareToken),
        })),
        lastAccessAt: m.lastAccessAt ? m.lastAccessAt.toISOString() : null,
        addedAt: m.createdAt.toISOString(),
        pendingInvite: false,
      };
    });

    // Pending OrganizationInvites bound to this campaign — same People list,
    // marked Invitation pending until accept creates CampaignMember.
    const pendingInvites = await prisma.organizationInvite.findMany({
      where: { organizationId, campaignId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        inviteeShortId: true,
        campaignRole: true,
        role: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    const pendingShortIds = pendingInvites
      .map((i) => i.inviteeShortId)
      .filter((s): s is string => Boolean(s));
    const pendingUsers = pendingShortIds.length
      ? await prisma.user.findMany({
          where: { shortId: { in: pendingShortIds } },
          select: { shortId: true, fullName: true },
        })
      : [];
    const pendingNameByShort = new Map(pendingUsers.map((u) => [u.shortId, u.fullName]));

    for (const inv of pendingInvites) {
      people.push({
        id: `invite:${inv.id}`,
        kind: 'internal',
        name: (inv.inviteeShortId && pendingNameByShort.get(inv.inviteeShortId))
          || inv.inviteeShortId
          || 'Pending invite',
        shortId: inv.inviteeShortId,
        email: null,
        platform: null,
        profileUrl: null,
        roleLabel: inv.campaignRole,
        orgRole: inv.role,
        accessStatus: 'INVITED',
        permissions: null,
        assets: [],
        lastAccessAt: null,
        addedAt: inv.createdAt.toISOString(),
        pendingInvite: true,
      });
    }

    return {
      client: campaign.client
        ? { name: campaign.client.name, contactName: campaign.client.contactName,
            contactEmail: campaign.client.contactEmail }
        : null,
      people,
    };
  },

  /**
   * Assign assets to an external person and issue their scoped links.
   *
   * Each asset gets its own link, so revoking one does not revoke the rest and
   * a forwarded link still only reaches the one file it was made for.
   */
  async grantAssetAccess(
    organizationId: string,
    actorUserId: string,
    campaignId: string,
    memberId: string,
    assetIds: string[],
    grant: AccessGrant = {},
  ) {
    // Granting outside access is a manager-level act.
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const member = await loadMemberScoped(organizationId, campaignId, memberId);

    if (!member.isExternal) {
      throw new AppError(
        400,
        'Internal team members already reach campaign assets through their organization role. '
        + 'Change their role in Team instead.',
      );
    }
    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      throw new AppError(400, 'Choose at least one asset to give access to');
    }

    // Every asset must belong to THIS campaign. Without this a manager could
    // hand an outsider a link to any asset id they could guess.
    const assets = await prisma.asset.findMany({
      where: { id: { in: assetIds }, campaignId },
      select: { id: true, vaultId: true, originalFilename: true, ownerUserId: true },
    });
    if (assets.length !== new Set(assetIds).size) {
      throw new AppError(400, 'One or more of those assets is not part of this campaign');
    }

    const canComment = grant.canComment ?? member.canComment;
    const canRequestChanges = grant.canRequestChanges ?? member.canRequestChanges;
    const canApprove = grant.canApprove ?? member.canApprove;

    // One share recipient per person, reused across their assets, so their
    // trust score and device history accumulate as one identity.
    let recipientId = member.shareRecipientId;
    if (!recipientId) {
      const recipient = await prisma.shareRecipient.create({
        data: {
          ownerUserId: actorUserId,
          label: member.name || member.email || 'External creator',
          recipientCode: `CRE-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        },
      });
      recipientId = recipient.id;
    }

    const issued: Array<{ assetId: string; filename: string; token: string | null }> = [];

    for (const asset of assets) {
      if (!asset.vaultId) {
        // Not protected yet — record the assignment, issue nothing.
        await prisma.campaignMemberAsset.upsert({
          where: { memberId_assetId: { memberId, assetId: asset.id } },
          create: { memberId, assetId: asset.id },
          update: {},
        });
        issued.push({ assetId: asset.id, filename: asset.originalFilename, token: null });
        continue;
      }

      const existing = member.assetAccess.find((a) => a.assetId === asset.id);
      if (existing?.shareToken) {
        issued.push({ assetId: asset.id, filename: asset.originalFilename, token: existing.shareToken });
        continue;
      }

      const link = await shareLinkService.create({
        vaultId: asset.vaultId,
        ownerUserId: asset.ownerUserId,
        assetId: asset.id,
        recipientLabel: member.name || 'External creator',
        shareRecipientId: recipientId,
        allowDownload: false,
        reviewMode: true,
        allowComments: canComment,
        allowChangeRequest: canRequestChanges,
        allowApproval: canApprove,
        ...(grant.expiresInHours ? { expiresIn: grant.expiresInHours } : {}),
      } as Parameters<typeof shareLinkService.create>[0]);

      await prisma.campaignMemberAsset.upsert({
        where: { memberId_assetId: { memberId, assetId: asset.id } },
        create: { memberId, assetId: asset.id, shareToken: link.token },
        update: { shareToken: link.token },
      });
      issued.push({ assetId: asset.id, filename: asset.originalFilename, token: link.token });
    }

    await prisma.campaignMember.update({
      where: { id: memberId },
      data: {
        accessStatus: 'ACTIVE',
        canComment, canRequestChanges, canApprove,
        shareRecipientId: recipientId,
        revokedAt: null,
      },
    });

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'CAMPAIGN_ACCESS_GRANTED',
      entityType: 'campaign', entityId: campaignId,
      title: `${member.name ?? 'External creator'} given access to `
        + `${issued.length} asset${issued.length === 1 ? '' : 's'}`,
      detail: { memberId, assetIds: issued.map((i) => i.assetId) },
    });

    // Activity, not a notification: granting access is a thing the team did on
    // purpose a moment ago, so telling them about it is noise. It belongs in
    // the record so anyone can see who can reach what.
    await emitBusinessEvent('creator.access_granted', {
      organizationId, campaignId,
      recipientLabel: member.name ?? 'External creator',
      actorUserId,
      detail: `${issued.length} asset${issued.length === 1 ? '' : 's'}.`,
    });

    return { issued, accessStatus: 'ACTIVE' as const };
  },

  /**
   * Take access away without erasing the record that they were involved.
   *
   * Revokes the underlying share links, so the tokens stop working immediately
   * — clearing our own rows alone would leave live links behind.
   */
  async revokeAccess(
    organizationId: string,
    actorUserId: string,
    campaignId: string,
    memberId: string,
    opts: { assetId?: string } = {},
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const member = await loadMemberScoped(organizationId, campaignId, memberId);

    const targets = opts.assetId
      ? member.assetAccess.filter((a) => a.assetId === opts.assetId)
      : member.assetAccess;

    let revoked = 0;
    for (const row of targets) {
      if (row.shareToken) {
        await prisma.shareLink.updateMany({
          where: { token: row.shareToken },
          data: { isActive: false },
        });
        revoked += 1;
      }
      await prisma.campaignMemberAsset.delete({ where: { id: row.id } }).catch(() => {});
    }

    const remaining = await prisma.campaignMemberAsset.count({ where: { memberId } });
    await prisma.campaignMember.update({
      where: { id: memberId },
      data: remaining === 0
        ? { accessStatus: 'REVOKED', revokedAt: new Date() }
        : {},
    });

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'CAMPAIGN_ACCESS_REVOKED',
      entityType: 'campaign', entityId: campaignId,
      title: opts.assetId
        ? `${member.name ?? 'External creator'} lost access to one asset`
        : `${member.name ?? 'External creator'} had all access revoked`,
      detail: { memberId, revokedLinks: revoked },
    });

    // Revocation IS worth a notification: it changes who can reach the work,
    // and a mistaken revocation strands a creator mid-job.
    await emitBusinessEvent('creator.access_revoked', {
      organizationId, campaignId,
      recipientLabel: member.name ?? 'External creator',
      actorUserId,
      detail: opts.assetId
        ? 'Access to one asset was withdrawn.'
        : `All access withdrawn (${revoked} link${revoked === 1 ? '' : 's'}).`,
    });

    return { revoked, remaining };
  },

  /** Update what an external person may do, and carry it to their live links. */
  async updatePermissions(
    organizationId: string,
    actorUserId: string,
    campaignId: string,
    memberId: string,
    grant: AccessGrant,
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const member = await loadMemberScoped(organizationId, campaignId, memberId);
    if (!member.isExternal) {
      throw new AppError(400, 'Internal team permissions are governed by their organization role');
    }

    const canComment = grant.canComment ?? member.canComment;
    const canRequestChanges = grant.canRequestChanges ?? member.canRequestChanges;
    const canApprove = grant.canApprove ?? member.canApprove;

    const tokens = member.assetAccess.map((a) => a.shareToken).filter((t): t is string => Boolean(t));
    if (tokens.length) {
      // Apply to the links they already hold — otherwise a permission change
      // would only affect assets granted afterwards.
      await prisma.shareLink.updateMany({
        where: { token: { in: tokens } },
        data: { allowComments: canComment, allowChangeRequest: canRequestChanges, allowApproval: canApprove },
      });
    }

    const updated = await prisma.campaignMember.update({
      where: { id: memberId },
      data: { canComment, canRequestChanges, canApprove },
    });

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'CAMPAIGN_ACCESS_UPDATED',
      entityType: 'campaign', entityId: campaignId,
      title: `Permissions changed for ${member.name ?? 'an external creator'}`,
      detail: { memberId, canComment, canRequestChanges, canApprove },
    });

    return {
      canComment: updated.canComment,
      canRequestChanges: updated.canRequestChanges,
      canApprove: updated.canApprove,
    };
  },

  /** The links a manager can copy and send. Never exposed to anyone else. */
  async listAccessLinks(organizationId: string, actorUserId: string, campaignId: string, memberId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const member = await loadMemberScoped(organizationId, campaignId, memberId);

    const tokens = member.assetAccess.map((a) => a.shareToken).filter((t): t is string => Boolean(t));
    const links = tokens.length
      ? await prisma.shareLink.findMany({
          where: { token: { in: tokens } },
          select: { token: true, isActive: true, expiresAt: true, viewCount: true, filename: true },
        })
      : [];

    return links.map((l) => ({
      token: l.token,
      filename: l.filename,
      active: l.isActive,
      expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
      viewCount: l.viewCount,
    }));
  },
};
