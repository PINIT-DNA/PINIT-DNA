/**
 * Business Account — Campaigns.
 *
 * The operational container for a client's work. Assets are attached here via
 * Asset.campaignId — Asset.id remains the one canonical identity across Hub and
 * Exchange; a Campaign never owns a second copy of anything, only a reference.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';

export interface CampaignInput {
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  budgetCents?: number;
}

export interface CampaignMemberInput {
  /**
   * Internal staff to connect — must already belong to this organization.
   *
   * Deliberately NOT named `userId`: the global stripClientOwnerIdentity guard
   * removes `userId`/`ownerUserId`-style keys from every request body so a
   * caller can never assert someone else's identity. This field is not an
   * ownership claim — it names a person to link, and is still validated against
   * organization membership below before anything is written.
   */
  memberUserId?: string;
  /** External creator/collaborator — no account required. */
  name?: string;
  platform?: string;
  profileUrl?: string;
  roleLabel?: string;
}

async function assertClientInOrg(organizationId: string, clientId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId } });
  if (!client) throw new AppError(404, 'Client not found');
  return client;
}

async function loadCampaignScoped(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, organizationId } });
  if (!campaign) throw new AppError(404, 'Campaign not found');
  return campaign;
}

function serializeCampaign(
  c: {
    id: string;
    clientId: string;
    name: string;
    description: string | null;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    budgetCents: number | null;
    createdAt: Date;
    updatedAt: Date;
  },
  counts?: { assets: number; members: number },
) {
  return {
    id: c.id,
    clientId: c.clientId,
    name: c.name,
    description: c.description,
    status: c.status,
    startDate: c.startDate ? c.startDate.toISOString() : null,
    endDate: c.endDate ? c.endDate.toISOString() : null,
    budgetCents: c.budgetCents,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    assetCount: counts?.assets ?? 0,
    memberCount: counts?.members ?? 0,
  };
}

function serializeMember(m: {
  id: string;
  userId: string | null;
  name: string | null;
  platform: string | null;
  profileUrl: string | null;
  roleLabel: string | null;
  isExternal: boolean;
  createdAt: Date;
}, userInfo?: { fullName: string | null; shortId: string } | null) {
  return {
    id: m.id,
    userId: m.userId,
    name: m.isExternal ? m.name : (userInfo?.fullName ?? m.name),
    shortId: userInfo?.shortId ?? null,
    platform: m.platform,
    profileUrl: m.profileUrl,
    roleLabel: m.roleLabel,
    isExternal: m.isExternal,
    addedAt: m.createdAt.toISOString(),
  };
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const campaignService = {
  async listForClient(organizationId: string, actorUserId: string, clientId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    await assertClientInOrg(organizationId, clientId);
    const campaigns = await prisma.campaign.findMany({
      where: { organizationId, clientId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { assets: true, members: true } } },
    });
    return campaigns.map((c) => serializeCampaign(c, { assets: c._count.assets, members: c._count.members }));
  },

  async get(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId },
      include: { _count: { select: { assets: true, members: true } }, client: { select: { id: true, name: true } } },
    });
    if (!campaign) throw new AppError(404, 'Campaign not found');
    return {
      ...serializeCampaign(campaign, { assets: campaign._count.assets, members: campaign._count.members }),
      client: campaign.client,
    };
  },

  async create(organizationId: string, actorUserId: string, clientId: string, input: CampaignInput) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const client = await assertClientInOrg(organizationId, clientId);
    const name = input.name?.trim();
    if (!name || name.length < 2) {
      throw new AppError(400, 'Campaign name must be at least 2 characters');
    }
    const startDate = parseDate(input.startDate);
    const endDate = parseDate(input.endDate);
    if (startDate && endDate && endDate < startDate) {
      throw new AppError(400, 'End date cannot be before start date');
    }
    const campaign = await prisma.campaign.create({
      data: {
        organizationId,
        clientId,
        createdByUserId: actorUserId,
        name,
        description: input.description?.trim() || null,
        startDate,
        endDate,
        budgetCents: typeof input.budgetCents === 'number' && input.budgetCents >= 0 ? Math.round(input.budgetCents) : null,
      },
    });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'CAMPAIGN_CREATED',
      entityType: 'campaign',
      entityId: campaign.id,
      title: `Campaign "${campaign.name}" created for ${client.name}`,
    });
    return serializeCampaign(campaign, { assets: 0, members: 0 });
  },

  async update(organizationId: string, actorUserId: string, campaignId: string, input: Partial<CampaignInput & { status: string }>) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const existing = await loadCampaignScoped(organizationId, campaignId);
    const startDate = input.startDate !== undefined ? parseDate(input.startDate) : existing.startDate;
    const endDate = input.endDate !== undefined ? parseDate(input.endDate) : existing.endDate;
    if (startDate && endDate && endDate < startDate) {
      throw new AppError(400, 'End date cannot be before start date');
    }
    const validStatuses = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];
    const status = input.status && validStatuses.includes(input.status) ? input.status : existing.status;
    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        name: input.name !== undefined ? input.name.trim() : existing.name,
        description: input.description !== undefined ? (input.description.trim() || null) : existing.description,
        startDate,
        endDate,
        budgetCents: input.budgetCents !== undefined ? Math.round(input.budgetCents) : existing.budgetCents,
        status: status as never,
      },
      include: { _count: { select: { assets: true, members: true } } },
    });
    return serializeCampaign(updated, { assets: updated._count.assets, members: updated._count.members });
  },

  async remove(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const existing = await loadCampaignScoped(organizationId, campaignId);
    await prisma.campaign.delete({ where: { id: campaignId } });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'CAMPAIGN_REMOVED',
      entityType: 'campaign',
      entityId: campaignId,
      title: `Campaign "${existing.name}" removed`,
    });
    return { ok: true };
  },

  // ── People ──────────────────────────────────────────────────────────────
  async listMembers(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    await loadCampaignScoped(organizationId, campaignId);
    const members = await prisma.campaignMember.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    });
    const userIds = members.filter((m) => m.userId).map((m) => m.userId as string);
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, shortId: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    return members.map((m) => serializeMember(m, m.userId ? userMap.get(m.userId) ?? null : null));
  },

  async addMember(organizationId: string, actorUserId: string, campaignId: string, input: CampaignMemberInput) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const campaign = await loadCampaignScoped(organizationId, campaignId);

    if (input.memberUserId) {
      // Internal staff — must already be a member of this organization.
      const memberUserId = input.memberUserId;
      const orgMember = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: memberUserId } },
      });
      const isOwner = !orgMember && (await prisma.organization.findFirst({
        where: { id: organizationId, ownerUserId: memberUserId },
      }));
      if (!orgMember && !isOwner) {
        throw new AppError(400, 'That person is not a member of this organization');
      }
      const existingLink = await prisma.campaignMember.findUnique({
        where: { campaignId_userId: { campaignId, userId: memberUserId } },
      });
      if (existingLink) throw new AppError(409, 'Already connected to this campaign');

      const created = await prisma.campaignMember.create({
        data: {
          campaignId,
          userId: memberUserId,
          roleLabel: input.roleLabel?.trim() || null,
          isExternal: false,
          addedByUserId: actorUserId,
        },
      });
      const user = await prisma.user.findUnique({ where: { id: memberUserId }, select: { fullName: true, shortId: true } });
      await logOrgAudit({
        organizationId,
        actorUserId,
        action: 'CAMPAIGN_MEMBER_ADDED',
        entityType: 'campaign',
        entityId: campaignId,
        title: `${user?.fullName ?? 'A team member'} connected to "${campaign.name}"`,
      });
      return serializeMember(created, user);
    }

    // External creator/collaborator — no account, lightweight record only.
    const name = input.name?.trim();
    if (!name) throw new AppError(400, 'Creator name is required');
    const created = await prisma.campaignMember.create({
      data: {
        campaignId,
        name,
        platform: input.platform?.trim() || null,
        profileUrl: input.profileUrl?.trim() || null,
        roleLabel: input.roleLabel?.trim() || null,
        isExternal: true,
        addedByUserId: actorUserId,
      },
    });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'CAMPAIGN_CREATOR_ADDED',
      entityType: 'campaign',
      entityId: campaignId,
      title: `${name} added as an external creator on "${campaign.name}"`,
    });
    return serializeMember(created, null);
  },

  async removeMember(organizationId: string, actorUserId: string, campaignId: string, memberId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    await loadCampaignScoped(organizationId, campaignId);
    const member = await prisma.campaignMember.findFirst({ where: { id: memberId, campaignId } });
    if (!member) throw new AppError(404, 'Not found on this campaign');
    await prisma.campaignMember.delete({ where: { id: memberId } });
    return { ok: true };
  },

  // ── Assets ──────────────────────────────────────────────────────────────
  async listAssets(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    await loadCampaignScoped(organizationId, campaignId);
    const assets = await prisma.asset.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalFilename: true,
        assetType: true,
        status: true,
        mimeType: true,
        sizeBytes: true,
        vaultId: true,
        createdAt: true,
      },
    });
    return assets.map((a) => ({
      id: a.id,
      originalFilename: a.originalFilename,
      assetType: a.assetType,
      status: a.status,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      vaultId: a.vaultId,
      createdAt: a.createdAt.toISOString(),
    }));
  },

  /** Attach an already-protected Asset (by canonical Asset.id) to this campaign. */
  async attachAsset(organizationId: string, actorUserId: string, campaignId: string, assetId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const campaign = await loadCampaignScoped(organizationId, campaignId);
    const asset = await prisma.asset.findFirst({ where: { id: assetId, ownerUserId: actorUserId } });
    if (!asset) throw new AppError(404, 'Asset not found, or you do not own it');
    await prisma.asset.update({ where: { id: assetId }, data: { campaignId } });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'CAMPAIGN_ASSET_ADDED',
      entityType: 'campaign',
      entityId: campaignId,
      title: `${asset.originalFilename} added to "${campaign.name}"`,
    });
    return { ok: true };
  },

  // ── Activity ────────────────────────────────────────────────────────────
  async listActivity(organizationId: string, actorUserId: string, campaignId: string, limit = 30) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    await loadCampaignScoped(organizationId, campaignId);
    const items = await prisma.organizationAuditLog.findMany({
      where: { organizationId, entityType: 'campaign', entityId: campaignId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return items.map((i) => ({
      id: i.id,
      createdAt: i.createdAt.toISOString(),
      action: i.action,
      title: i.title,
    }));
  },
};
