import { prisma } from '../../lib/prisma';
import crypto from 'crypto';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import { entitlementService } from '../subscription/entitlements/entitlement.service';

function generateWorkspaceShortId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) id += chars[bytes[i]! % chars.length];
  return `PINIT-WS-${id}`;
}

export const workspaceService = {
  async list(organizationId: string, actorUserId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const workspaces = await prisma.workspace.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return workspaces.map((w) => ({
      id: w.id,
      shortId: w.shortId,
      name: w.name,
      isDefault: w.isDefault,
      createdAt: w.createdAt.toISOString(),
    }));
  },

  async create(organizationId: string, actorUserId: string, name: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const entitlements = await entitlementService.getEntitlements(actorUserId);
    const count = await prisma.workspace.count({ where: { organizationId } });
    const limit = entitlements.workspaceLimit;
    if (limit !== null && count >= limit) {
      throw Object.assign(new Error('Workspace limit reached for your plan'), { status: 403 });
    }
    const workspace = await prisma.workspace.create({
      data: {
        organizationId,
        shortId: generateWorkspaceShortId(),
        name: name.trim(),
        isDefault: false,
      },
    });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'WORKSPACE_CREATED',
      entityType: 'workspace',
      entityId: workspace.id,
      title: `Workspace "${workspace.name}" created`,
    });
    return { id: workspace.id, name: workspace.name, isDefault: workspace.isDefault };
  },

  async update(organizationId: string, actorUserId: string, workspaceId: string, name: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, organizationId } });
    if (!ws) throw Object.assign(new Error('Workspace not found'), { status: 404 });
    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: name.trim() },
    });
    return { id: updated.id, name: updated.name, isDefault: updated.isDefault };
  },
};
