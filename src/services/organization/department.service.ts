import { prisma } from '../../lib/prisma';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';

export const departmentService = {
  async list(organizationId: string, actorUserId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const departments = await prisma.department.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true, dnaRecords: true } } },
    });
    return departments.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      memberCount: d._count.members,
      assetCount: d._count.dnaRecords,
    }));
  },

  async create(
    organizationId: string,
    actorUserId: string,
    input: { name: string; description?: string },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const name = input.name.trim();
    if (name.length < 2) {
      throw Object.assign(new Error('Department name too short'), { status: 400 });
    }
    const dept = await prisma.department.create({
      data: {
        organizationId,
        name,
        description: input.description?.trim() || null,
      },
    });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'DEPARTMENT_CREATED',
      entityType: 'department',
      entityId: dept.id,
      title: `Department "${dept.name}" created`,
    });
    return { id: dept.id, name: dept.name, description: dept.description };
  },

  async update(
    organizationId: string,
    actorUserId: string,
    departmentId: string,
    input: { name?: string; description?: string },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const dept = await prisma.department.findFirst({
      where: { id: departmentId, organizationId },
    });
    if (!dept) throw Object.assign(new Error('Department not found'), { status: 404 });
    const updated = await prisma.department.update({
      where: { id: departmentId },
      data: {
        name: input.name?.trim() ?? dept.name,
        description: input.description !== undefined ? (input.description.trim() || null) : dept.description,
      },
    });
    return { id: updated.id, name: updated.name, description: updated.description };
  },

  async remove(organizationId: string, actorUserId: string, departmentId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const dept = await prisma.department.findFirst({
      where: { id: departmentId, organizationId },
    });
    if (!dept) throw Object.assign(new Error('Department not found'), { status: 404 });
    await prisma.department.delete({ where: { id: departmentId } });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'DEPARTMENT_REMOVED',
      entityType: 'department',
      entityId: departmentId,
      title: `Department "${dept.name}" removed`,
    });
    return { ok: true };
  },
};
