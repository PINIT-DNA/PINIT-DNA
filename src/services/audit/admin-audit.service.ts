/**
 * PINIT-DNA — Admin Audit Log (Master Admin Phase 1)
 *
 * Platform-wide "who changed what" log for actions taken through the
 * super-admin console. Distinct from AuditEvent (per-file/DNA forensic
 * events) and OrganizationAuditLog (tenant-scoped) — this one exists
 * specifically because super-admin mutations were not logged anywhere.
 *
 * Intended append-only: nothing in this codebase should ever call
 * prisma.adminAuditEvent.update() or .delete(). A DB-level REVOKE on
 * UPDATE/DELETE is the harder enforcement and is not applied yet — see
 * the Phase 1 report for why.
 */
import { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { resolveClientIp } from '../../lib/request-utils';

export interface RecordAdminActionParams {
  actorUserId: string;
  actorShortId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  req?: Request;
}

export class AdminAuditService {
  async record(params: RecordAdminActionParams): Promise<void> {
    try {
      await prisma.adminAuditEvent.create({
        data: {
          actorUserId: params.actorUserId,
          actorShortId: params.actorShortId ?? null,
          action: params.action,
          targetType: params.targetType ?? null,
          targetId: params.targetId ?? null,
          before: params.before === undefined ? undefined : (params.before as object),
          after: params.after === undefined ? undefined : (params.after as object),
          reason: params.reason ?? null,
          ipAddress: params.req ? resolveClientIp(params.req) : null,
          userAgent: params.req?.headers['user-agent'] ?? null,
          requestMethod: params.req?.method ?? null,
          requestPath: params.req?.originalUrl ?? null,
        },
      });
    } catch (err) {
      // Non-fatal — never block an admin action because audit logging failed,
      // but this is loud (error, not warn) because a silently-missing admin
      // audit row is a real governance gap.
      logger.error('Admin audit log failed', {
        action: params.action,
        actorUserId: params.actorUserId,
        error: String(err),
      });
    }
  }

  async list(params: { limit?: number; actorUserId?: string; action?: string; targetType?: string }) {
    return prisma.adminAuditEvent.findMany({
      where: {
        actorUserId: params.actorUserId,
        action: params.action,
        targetType: params.targetType,
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 100,
    });
  }
}

export const adminAuditService = new AdminAuditService();
