import { prisma } from '../../lib/prisma';
import type { Prisma } from '@prisma/client';

export async function logOrgAudit(input: {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  title: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.organizationAuditLog.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        title: input.title,
        detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch {
    /* non-fatal */
  }
}

export async function listOrgAuditLogs(
  organizationId: string,
  limit = 50,
  offset = 0,
) {
  const [items, total] = await Promise.all([
    prisma.organizationAuditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.organizationAuditLog.count({ where: { organizationId } }),
  ]);
  return {
    total,
    items: items.map((i) => ({
      id: i.id,
      createdAt: i.createdAt.toISOString(),
      actorUserId: i.actorUserId,
      action: i.action,
      entityType: i.entityType,
      entityId: i.entityId,
      title: i.title,
      detail: i.detail,
    })),
  };
}
