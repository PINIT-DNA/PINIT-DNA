/**
 * Business Account — Client relationships.
 *
 * The first missing piece of the agency operating layer: a business's customers,
 * distinct from the business's own internal Department/Workspace structure.
 * Mirrors department.service.ts's isolation/audit pattern exactly.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';

export interface ClientInput {
  name: string;
  companyName?: string;
  website?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
}

function serialize(
  client: {
    id: string;
    name: string;
    companyName: string | null;
    website: string | null;
    contactName: string | null;
    contactEmail: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  counts?: { campaigns: number },
) {
  return {
    id: client.id,
    name: client.name,
    companyName: client.companyName,
    website: client.website,
    contactName: client.contactName,
    contactEmail: client.contactEmail,
    notes: client.notes,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
    campaignCount: counts?.campaigns ?? 0,
  };
}

export const clientService = {
  async list(organizationId: string, actorUserId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const clients = await prisma.client.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { campaigns: true } } },
    });
    return clients.map((c) => serialize(c, { campaigns: c._count.campaigns }));
  },

  async get(organizationId: string, actorUserId: string, clientId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId },
      include: { _count: { select: { campaigns: true } } },
    });
    if (!client) throw new AppError(404, 'Client not found');
    return serialize(client, { campaigns: client._count.campaigns });
  },

  async create(organizationId: string, actorUserId: string, input: ClientInput) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const name = input.name?.trim();
    if (!name || name.length < 2) {
      throw new AppError(400, 'Client name must be at least 2 characters');
    }
    const client = await prisma.client.create({
      data: {
        organizationId,
        createdByUserId: actorUserId,
        name,
        companyName: input.companyName?.trim() || null,
        website: input.website?.trim() || null,
        contactName: input.contactName?.trim() || null,
        contactEmail: input.contactEmail?.trim() || null,
        notes: input.notes?.trim() || null,
      },
    });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'CLIENT_CREATED',
      entityType: 'client',
      entityId: client.id,
      title: `Client "${client.name}" added`,
    });
    return serialize(client, { campaigns: 0 });
  },

  async update(organizationId: string, actorUserId: string, clientId: string, input: Partial<ClientInput>) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const existing = await prisma.client.findFirst({ where: { id: clientId, organizationId } });
    if (!existing) throw new AppError(404, 'Client not found');
    const updated = await prisma.client.update({
      where: { id: clientId },
      data: {
        name: input.name !== undefined ? input.name.trim() : existing.name,
        companyName: input.companyName !== undefined ? (input.companyName.trim() || null) : existing.companyName,
        website: input.website !== undefined ? (input.website.trim() || null) : existing.website,
        contactName: input.contactName !== undefined ? (input.contactName.trim() || null) : existing.contactName,
        contactEmail: input.contactEmail !== undefined ? (input.contactEmail.trim() || null) : existing.contactEmail,
        notes: input.notes !== undefined ? (input.notes.trim() || null) : existing.notes,
      },
      include: { _count: { select: { campaigns: true } } },
    });
    return serialize(updated, { campaigns: updated._count.campaigns });
  },

  async remove(organizationId: string, actorUserId: string, clientId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const existing = await prisma.client.findFirst({ where: { id: clientId, organizationId } });
    if (!existing) throw new AppError(404, 'Client not found');
    await prisma.client.delete({ where: { id: clientId } });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'CLIENT_REMOVED',
      entityType: 'client',
      entityId: clientId,
      title: `Client "${existing.name}" removed`,
    });
    return { ok: true };
  },
};
