/**
 * PINIT-DNA — Super Admin Console API: Role/session administration, billing, notifications, incidents, RBAC, reports.
 * (Split out of super-admin.controller.ts, which re-exports it; handler code is unchanged.)
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import { AppError } from '../../middleware/error.middleware';
import {} from '../../../lib/health';
import { adminAuditService } from '../../../services/audit/admin-audit.service';
import { ADMIN_DOMAINS,  getRoleCapabilityMatrix } from '../../../config/admin-capabilities';
import {} from '../../../lib/platform-owner';

const DAY_MS = 24 * 60 * 60 * 1000;


// ─── POST /super-admin/users/:id/role ─────────────────────────────────────────

export async function updateUserRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, reason } = req.body as { role?: string; reason?: string };
    const allowed = ['SUPER_ADMIN', 'ADMIN', 'ANALYST', 'AUDITOR', 'USER'];
    if (!role || !allowed.includes(role)) {
      next(new AppError(400, 'Invalid role'));
      return;
    }
    const before = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, shortId: true, role: true },
    });
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role: role as never },
      select: { id: true, shortId: true, role: true },
    });

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: 'user.role_update',
        targetType: 'User',
        targetId: user.id,
        before,
        after: user,
        reason: reason ?? null,
        req,
      });
    }

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}

// ─── POST /super-admin/users/:id/toggle ───────────────────────────────────────

export async function toggleUserActive(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { reason } = req.body as { reason?: string };
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      next(new AppError(404, 'User not found'));
      return;
    }
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !user.isActive },
      select: { id: true, shortId: true, isActive: true },
    });

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: updated.isActive ? 'user.activate' : 'user.suspend',
        targetType: 'User',
        targetId: updated.id,
        before: { id: user.id, shortId: user.shortId, isActive: user.isActive },
        after: updated,
        reason: reason ?? null,
        req,
      });
    }

    res.json({ success: true, user: updated });
  } catch (err) {
    next(err);
  }
}

// ─── Session & device revocation ───────────────────────────────────────────
// requireAuth verifies JWT signature + expiry only — it does not look up
// UserSession on every request (see api/middleware/auth.middleware.ts). So
// revoking a session marks it invalid for audit purposes and deletes that
// user's refresh tokens (blocking silent re-issuance of a new access token),
// but an already-issued access token remains valid for the rest of its own
// 7-day life. That's a real, honest limit of the current stateless-JWT
// design — the UI says so rather than implying an instant kill switch.

// ─── POST /super-admin/sessions/:id/revoke ─────────────────────────────────

export async function revokeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await prisma.userSession.findUnique({ where: { id: req.params.id } });
    if (!session) {
      next(new AppError(404, 'Session not found'));
      return;
    }
    const updated = await prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
      select: { id: true, userId: true, revokedAt: true },
    });

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: 'user.session_revoke',
        targetType: 'UserSession',
        targetId: session.id,
        before: { id: session.id, revokedAt: session.revokedAt },
        after: updated,
        req,
      });
    }

    res.json({ success: true, session: updated });
  } catch (err) {
    next(err);
  }
}

// ─── POST /super-admin/devices/:id/untrust ─────────────────────────────────

export async function untrustDevice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const device = await prisma.userDevice.findUnique({ where: { id: req.params.id } });
    if (!device) {
      next(new AppError(404, 'Device not found'));
      return;
    }
    const updated = await prisma.userDevice.update({
      where: { id: device.id },
      data: { isTrusted: !device.isTrusted },
      select: { id: true, userId: true, isTrusted: true, deviceLabel: true },
    });

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: updated.isTrusted ? 'user.device_trust' : 'user.device_untrust',
        targetType: 'UserDevice',
        targetId: device.id,
        before: { id: device.id, isTrusted: device.isTrusted },
        after: updated,
        req,
      });
    }

    res.json({ success: true, device: updated });
  } catch (err) {
    next(err);
  }
}

// ─── POST /super-admin/users/:id/sign-out-everywhere ───────────────────────

export async function signOutEverywhere(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.params.id;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, shortId: true } });
    if (!user) {
      next(new AppError(404, 'User not found'));
      return;
    }

    const [sessionResult, tokenResult] = await Promise.all([
      prisma.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: 'user.sign_out_everywhere',
        targetType: 'User',
        targetId: user.id,
        after: { sessionsRevoked: sessionResult.count, refreshTokensDeleted: tokenResult.count },
        req,
      });
    }

    res.json({ success: true, sessionsRevoked: sessionResult.count, refreshTokensDeleted: tokenResult.count });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/billing ──────────────────────────────────────────────
// Real Subscription/BillingHistory/Plan data — no Exchange marketplace figures
// here (those stay honestly "not connected" on the Command Center).

export async function getBillingOverview(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [plans, subscriptions, history, revenueAgg, failedCount, planCounts] = await Promise.all([
      prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.subscription.findMany({
        include: {
          user: { select: { id: true, shortId: true, fullName: true, email: true } },
          plan: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.billingHistory.findMany({
        include: {
          subscription: {
            select: {
              user: { select: { shortId: true, fullName: true } },
              plan: { select: { code: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.billingHistory.aggregate({ where: { status: 'SUCCEEDED' }, _sum: { amountCents: true } }),
      prisma.billingHistory.count({ where: { status: 'FAILED' } }),
      prisma.subscription.groupBy({ by: ['planId', 'status'], _count: true }),
    ]);

    const planCountMap: Record<string, Record<string, number>> = {};
    for (const row of planCounts as { planId: string; status: string; _count: number }[]) {
      planCountMap[row.planId] ??= {};
      planCountMap[row.planId][row.status] = row._count;
    }

    res.json({
      success: true,
      summary: {
        totalRevenueCents: revenueAgg._sum.amountCents ?? 0,
        totalSubscriptions: subscriptions.length,
        failedPayments: failedCount,
      },
      plans: plans.map((p) => ({
        ...p,
        storageLimitBytes: p.storageLimitBytes ? p.storageLimitBytes.toString() : null,
        subscriberCounts: planCountMap[p.id] ?? {},
      })),
      subscriptions,
      billingHistory: history,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/notifications ────────────────────────────────────────
// Cross-tenant view of the same Notification rows that back each user's own
// bell — the aggregate unreadNotifications KPI on the Command Center links
// here for the underlying rows.

export async function listNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50));
    const offset = Math.max(0, Number(req.query['offset']) || 0);
    const severity = typeof req.query['severity'] === 'string' ? req.query['severity'] : undefined;
    const category = typeof req.query['category'] === 'string' ? req.query['category'] : undefined;
    const unreadOnly = req.query['unread'] === 'true';

    const where = {
      severity,
      category,
      read: unreadOnly ? false : undefined,
      archived: false,
    };

    const [notifications, total, unreadCount, alertCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        include: { user: { select: { shortId: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { read: false, archived: false } }),
      prisma.notification.count({ where: { read: false, archived: false, notificationClass: 'ALERT' } }),
    ]);

    res.json({
      success: true,
      notifications,
      total,
      unreadCount,
      alertCount,
      hasMore: offset + notifications.length < total,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/incidents ────────────────────────────────────────────
// Cross-tenant view of crawler-detected leak cases (Incident + EvidenceRecord)
// — the case-management model already exists and is populated by the
// monitoring pipeline; this is its first admin-facing view.

export async function listIncidents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query['limit']) || 100));
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const severity = typeof req.query['severity'] === 'string' ? req.query['severity'] : undefined;

    const where = { status, severity };

    const [incidents, total, openCount, highCount] = await Promise.all([
      prisma.incident.findMany({
        where,
        include: { evidenceRecords: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.incident.count({ where }),
      prisma.incident.count({ where: { status: 'OPEN' } }),
      prisma.incident.count({ where: { severity: 'HIGH', status: 'OPEN' } }),
    ]);

    const dnaRecordIds = [...new Set(incidents.map((i) => i.dnaRecordId).filter((v): v is string => !!v))];
    const dnaRecords = dnaRecordIds.length
      ? await prisma.dnaRecord.findMany({
          where: { id: { in: dnaRecordIds } },
          select: { id: true, imageFilename: true, ownerUser: { select: { shortId: true, fullName: true } } },
        })
      : [];
    const dnaById = new Map(dnaRecords.map((d) => [d.id, d]));

    res.json({
      success: true,
      incidents: incidents.map((i) => ({
        ...i,
        evidenceCount: i.evidenceRecords.length,
        evidenceRecords: undefined,
        dnaRecord: i.dnaRecordId ? dnaById.get(i.dnaRecordId) ?? null : null,
      })),
      total,
      openCount,
      highCount,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/incidents/:id ────────────────────────────────────────

export async function getIncidentDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id },
      include: {
        evidenceRecords: true,
        notes: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!incident) {
      next(new AppError(404, 'Incident not found'));
      return;
    }
    const dnaRecord = incident.dnaRecordId
      ? await prisma.dnaRecord.findUnique({
          where: { id: incident.dnaRecordId },
          select: { id: true, imageFilename: true, ownerUser: { select: { shortId: true, fullName: true } } },
        })
      : null;

    res.json({ success: true, incident: { ...incident, dnaRecord } });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/biometric-identities ─────────────────────────────────
// Cross-tenant view of enrolled biometric identities. Never selects
// templateCipher / templateHash — those are the encrypted biometric secrets
// and have no legitimate reason to leave the auth service, even to the
// platform owner's own console.

export async function listBiometricIdentities(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const identities = await prisma.biometricIdentity.findMany({
      include: {
        user: { select: { id: true, shortId: true, fullName: true, email: true, role: true } },
        faceTemplate: { select: { createdAt: true, algorithm: true, modelVersion: true } },
        voiceTemplate: { select: { createdAt: true, algorithm: true, modelVersion: true } },
        fingerprintTemplate: { select: { createdAt: true, algorithm: true, modelVersion: true, credentialId: true } },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    const activeCount = identities.filter((i) => i.status === 'ACTIVE').length;
    const fullyEnrolledCount = identities.filter((i) => i.faceTemplate && i.voiceTemplate && i.fingerprintTemplate).length;

    res.json({
      success: true,
      identities,
      total: identities.length,
      activeCount,
      fullyEnrolledCount,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/rbac-matrix ──────────────────────────────────────────
// Static config re-exposed for the System & Settings page — no DB query.
// Single source of truth stays admin-capabilities.ts; this just makes it
// visible instead of only enforced.

export async function getRbacMatrix(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      success: true,
      domains: ADMIN_DOMAINS,
      matrix: getRoleCapabilityMatrix(),
      platformOwnerNote: 'The platform-owner shortId allowlist additionally gates every destructive action, regardless of role or domain access shown here.',
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/reports/platform-summary ─────────────────────────────
// On-demand aggregation for a date range — no stored "report" row, computed
// fresh from the same tables the rest of the console already reads.

export async function getPlatformSummaryReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const from = typeof req.query['from'] === 'string' ? new Date(req.query['from']) : new Date(Date.now() - 30 * DAY_MS);
    const to = typeof req.query['to'] === 'string' ? new Date(req.query['to']) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      next(new AppError(400, 'Invalid date range'));
      return;
    }
    const range = { gte: from, lte: to };

    const [
      newUsers, newOrganizations, dnaGenerated, certificatesIssued,
      incidentsBySeverity, revenueAgg, logins, adminActions, incidentsResolved,
    ] = await Promise.all([
      prisma.user.count({ where: { createdAt: range } }),
      prisma.organization.count({ where: { createdAt: range } }),
      prisma.dnaRecord.count({ where: { createdAt: range } }),
      prisma.certificate.count({ where: { createdAt: range } }),
      prisma.incident.groupBy({ by: ['severity'], where: { createdAt: range }, _count: true }),
      prisma.billingHistory.aggregate({ where: { createdAt: range, status: 'SUCCEEDED' }, _sum: { amountCents: true } }),
      prisma.loginHistory.count({ where: { createdAt: range, success: true } }),
      prisma.adminAuditEvent.count({ where: { createdAt: range } }),
      prisma.incident.count({ where: { createdAt: range, status: { not: 'OPEN' } } }),
    ]);

    res.json({
      success: true,
      range: { from: from.toISOString(), to: to.toISOString() },
      generatedAt: new Date().toISOString(),
      newUsers,
      newOrganizations,
      dnaGenerated,
      certificatesIssued,
      incidentsOpened: (incidentsBySeverity as { severity: string; _count: number }[]).reduce((s, r) => s + r._count, 0),
      incidentsResolved,
      incidentsBySeverity: (incidentsBySeverity as { severity: string; _count: number }[]).map((r) => ({ severity: r.severity, count: r._count })),
      revenueCents: revenueAgg._sum.amountCents ?? 0,
      successfulLogins: logins,
      adminActionsTaken: adminActions,
    });
  } catch (err) {
    next(err);
  }
}
