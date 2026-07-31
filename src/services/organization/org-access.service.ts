import { prisma } from '../../lib/prisma';
import {
  OrganizationMemberRole,
  roleMeetsMinimum,
  type OrganizationMemberRole as OrgRole,
} from './constants/org-rbac';

export interface OrgMembership {
  organizationId: string;
  userId: string;
  role: OrgRole;
  departmentId: string | null;
}

export async function getMembershipForUser(
  userId: string,
  organizationId?: string,
): Promise<OrgMembership | null> {
  if (organizationId) {
    const m = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!m) return null;
    return {
      organizationId: m.organizationId,
      userId: m.userId,
      role: m.role as OrgRole,
      departmentId: m.departmentId,
    };
  }

  const owned = await prisma.organization.findUnique({
    where: { ownerUserId: userId },
    select: { id: true },
  });
  if (owned) {
    return {
      organizationId: owned.id,
      userId,
      role: OrganizationMemberRole.OWNER,
      departmentId: null,
    };
  }

  const member = await prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
  });
  if (!member) return null;
  return {
    organizationId: member.organizationId,
    userId: member.userId,
    role: member.role as OrgRole,
    departmentId: member.departmentId,
  };
}

export async function requireOrgRole(
  userId: string,
  organizationId: string,
  minimum: OrgRole,
): Promise<OrgMembership> {
  const membership = await getMembershipForUser(userId, organizationId);
  if (!membership) {
    throw Object.assign(new Error('Not a member of this organization'), { status: 403 });
  }
  if (!roleMeetsMinimum(membership.role, minimum)) {
    throw Object.assign(new Error('Insufficient organization permissions'), { status: 403 });
  }
  return membership;
}

export async function getOrganizationIdForUser(userId: string): Promise<string | null> {
  const m = await getMembershipForUser(userId);
  return m?.organizationId ?? null;
}

export async function canAccessOrgDna(userId: string, dnaRecordId: string): Promise<boolean> {
  const rec = await prisma.dnaRecord.findUnique({
    where: { id: dnaRecordId },
    select: { ownerUserId: true, organizationId: true },
  });
  if (!rec) return false;
  if (rec.ownerUserId === userId) return true;
  if (!rec.organizationId) return false;
  const membership = await getMembershipForUser(userId, rec.organizationId);
  return membership !== null;
}
