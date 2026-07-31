import { prisma } from '../../lib/prisma';
import { getOrganizationIdForUser } from './org-access.service';

/** Resolve org + default workspace for tagging new business assets. */
export async function resolveOrgAssetContext(userId: string): Promise<{
  organizationId: string | null;
  workspaceId: string | null;
}> {
  const orgId = await getOrganizationIdForUser(userId);
  if (!orgId) return { organizationId: null, workspaceId: null };

  const ws = await prisma.workspace.findFirst({
    where: { organizationId: orgId, isDefault: true },
    select: { id: true },
  });
  return { organizationId: orgId, workspaceId: ws?.id ?? null };
}

/** Tag a DNA record with organization context (business accounts). */
export async function tagDnaWithOrgContext(
  dnaRecordId: string,
  userId: string,
): Promise<{ organizationId: string; workspaceId: string | null } | null> {
  const ctx = await resolveOrgAssetContext(userId);
  if (!ctx.organizationId) return null;
  await prisma.dnaRecord.update({
    where: { id: dnaRecordId },
    data: {
      organizationId: ctx.organizationId,
      workspaceId: ctx.workspaceId,
    },
  });
  return { organizationId: ctx.organizationId, workspaceId: ctx.workspaceId };
}

/** Prisma where clause: personal assets OR org-shared assets for member. */
export async function vaultAccessWhere(userId: string) {
  const orgId = await getOrganizationIdForUser(userId);
  if (!orgId) {
    return { dnaRecord: { ownerUserId: userId } };
  }
  return {
    OR: [
      { dnaRecord: { ownerUserId: userId } },
      { dnaRecord: { organizationId: orgId } },
    ],
  };
}

export async function dnaAccessWhere(userId: string) {
  const orgId = await getOrganizationIdForUser(userId);
  if (!orgId) return { ownerUserId: userId };
  return {
    OR: [{ ownerUserId: userId }, { organizationId: orgId }],
  };
}
