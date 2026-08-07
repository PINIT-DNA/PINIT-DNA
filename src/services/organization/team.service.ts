import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { OrganizationMemberRole, type OrganizationMemberRole as OrgRole } from './constants/org-rbac';
import { requireOrgRole } from './org-access.service';
import { logOrgAudit } from './audit-log.service';
import { platformEvents } from '../platform-events/platform-event.engine';
import { entitlementService } from '../subscription/entitlements/entitlement.service';

const INVITE_TTL_DAYS = 14;

function generateInviteToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

async function ensureOwnerMember(organizationId: string, ownerUserId: string) {
  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: ownerUserId } },
  });
  if (existing) return;
  await prisma.organizationMember.create({
    data: {
      organizationId,
      userId: ownerUserId,
      role: OrganizationMemberRole.OWNER,
    },
  });
}

export const teamService = {
  ensureOwnerMember,

  async listMembers(organizationId: string, actorUserId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const members = await prisma.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: { select: { id: true, shortId: true, fullName: true, email: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      shortId: m.user.shortId,
      fullName: m.user.fullName,
      email: m.user.email,
      role: m.role,
      department: m.department,
      joinedAt: m.joinedAt.toISOString(),
    }));
  },

  async countMembers(organizationId: string): Promise<number> {
    return prisma.organizationMember.count({ where: { organizationId } });
  },

  async listInvites(organizationId: string, actorUserId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const invites = await prisma.organizationInvite.findMany({
      where: { organizationId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      inviteeShortId: i.inviteeShortId,
      role: i.role,
      status: i.status,
      token: i.token,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    }));
  },

  async inviteMember(
    organizationId: string,
    actorUserId: string,
    input: { email?: string; inviteeShortId?: string; role?: OrgRole },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);

    const entitlements = await entitlementService.getEntitlements(actorUserId);
    const currentCount = await this.countMembers(organizationId);
    const pendingCount = await prisma.organizationInvite.count({
      where: { organizationId, status: 'PENDING' },
    });
    const limit = entitlements.teamMemberLimit;
    if (limit !== null && currentCount + pendingCount >= limit) {
      throw Object.assign(new Error('Team member limit reached for your plan'), { status: 403 });
    }

    const role = input.role ?? OrganizationMemberRole.MEMBER;
    if (role === OrganizationMemberRole.OWNER) {
      throw Object.assign(new Error('Cannot invite as Owner'), { status: 400 });
    }

    let targetUserId: string | null = null;
    if (input.inviteeShortId?.trim()) {
      const u = await prisma.user.findUnique({
        where: { shortId: input.inviteeShortId.trim() },
        select: { id: true },
      });
      if (!u) throw Object.assign(new Error('User not found'), { status: 404 });
      targetUserId = u.id;
      const existing = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: u.id } },
      });
      if (existing) throw Object.assign(new Error('User is already a member'), { status: 409 });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);

    const invite = await prisma.organizationInvite.create({
      data: {
        organizationId,
        email: input.email?.trim() || null,
        inviteeShortId: input.inviteeShortId?.trim() || null,
        role,
        token: generateInviteToken(),
        invitedByUserId: actorUserId,
        expiresAt,
      },
    });

    if (targetUserId) {
      platformEvents.emit({
        name: 'ORG_TEAM_INVITE',
        category: 'system',
        severity: 'info',
        ownerUserId: targetUserId,
        actorUserId,
        entityType: 'organization_invite',
        entityId: invite.id,
        title: 'Organization invitation',
        body: 'You have been invited to join an organization on Pinit HUB.',
        deepLink: `/team/join/${invite.token}`,
        payload: { organizationId, role, inviteToken: invite.token },
      });
    }

    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'MEMBER_INVITED',
      entityType: 'organization_invite',
      entityId: invite.id,
      title: `Invited ${input.email ?? input.inviteeShortId ?? 'via link'} as ${role}`,
    });

    return {
      id: invite.id,
      token: invite.token,
      expiresAt: invite.expiresAt.toISOString(),
      role: invite.role,
    };
  },

  async acceptInvite(userId: string, token: string) {
    const invite = await prisma.organizationInvite.findUnique({ where: { token } });
    if (!invite || invite.status !== 'PENDING') {
      throw Object.assign(new Error('Invalid or expired invitation'), { status: 404 });
    }
    if (invite.expiresAt < new Date()) {
      await prisma.organizationInvite.update({
        where: { id: invite.id },
        data: { status: 'EXPIRED' },
      });
      throw Object.assign(new Error('Invitation expired'), { status: 410 });
    }

    if (invite.inviteeShortId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { shortId: true },
      });
      if (!user || user.shortId !== invite.inviteeShortId) {
        throw Object.assign(new Error('This invitation is for a different PinIT account'), { status: 403 });
      }
    }

    const existing = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: invite.organizationId, userId } },
    });
    if (existing) {
      await prisma.organizationInvite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedUserId: userId },
      });
      return { organizationId: invite.organizationId, role: existing.role, alreadyMember: true };
    }

    await prisma.$transaction([
      prisma.organizationMember.create({
        data: {
          organizationId: invite.organizationId,
          userId,
          role: invite.role,
          invitedByUserId: invite.invitedByUserId,
        },
      }),
      prisma.organizationInvite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedUserId: userId },
      }),
    ]);

    await logOrgAudit({
      organizationId: invite.organizationId,
      actorUserId: userId,
      action: 'MEMBER_JOINED',
      entityType: 'organization_member',
      entityId: userId,
      title: 'New member joined the organization',
    });

    return { organizationId: invite.organizationId, role: invite.role, alreadyMember: false };
  },

  async revokeInvite(organizationId: string, actorUserId: string, inviteId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const invite = await prisma.organizationInvite.findFirst({
      where: { id: inviteId, organizationId, status: 'PENDING' },
    });
    if (!invite) throw Object.assign(new Error('Invite not found'), { status: 404 });
    await prisma.organizationInvite.update({
      where: { id: inviteId },
      data: { status: 'REVOKED' },
    });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'INVITE_REVOKED',
      entityType: 'organization_invite',
      entityId: inviteId,
      title: 'Team invitation revoked',
    });
    return { ok: true };
  },

  async updateMemberRole(
    organizationId: string,
    actorUserId: string,
    memberId: string,
    role: OrgRole,
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.OWNER);
    if (role === OrganizationMemberRole.OWNER) {
      throw Object.assign(new Error('Transfer ownership separately'), { status: 400 });
    }
    const member = await prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!member) throw Object.assign(new Error('Member not found'), { status: 404 });
    if (member.role === OrganizationMemberRole.OWNER) {
      throw Object.assign(new Error('Cannot change owner role'), { status: 400 });
    }
    const updated = await prisma.organizationMember.update({
      where: { id: memberId },
      data: { role },
    });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'ROLE_CHANGED',
      entityType: 'organization_member',
      entityId: memberId,
      title: `Role changed to ${role}`,
    });
    return { id: updated.id, role: updated.role };
  },

  async removeMember(organizationId: string, actorUserId: string, memberId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const member = await prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!member) throw Object.assign(new Error('Member not found'), { status: 404 });
    if (member.role === OrganizationMemberRole.OWNER) {
      throw Object.assign(new Error('Cannot remove owner'), { status: 400 });
    }
    await prisma.organizationMember.delete({ where: { id: memberId } });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'MEMBER_REMOVED',
      entityType: 'organization_member',
      entityId: memberId,
      title: 'Member removed from organization',
    });
    return { ok: true };
  },

  async getTeamSummary(organizationId: string, actorUserId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const members = await this.listMembers(organizationId, actorUserId);
    const pendingInvites = await prisma.organizationInvite.count({
      where: { organizationId, status: 'PENDING' },
    });
    const byRole = members.reduce<Record<string, number>>((acc, m) => {
      acc[m.role] = (acc[m.role] ?? 0) + 1;
      return acc;
    }, {});
    return { members, pendingInvites, byRole, total: members.length };
  },
};
