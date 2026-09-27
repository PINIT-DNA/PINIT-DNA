/**
 * PINIT-DNA — Super Admin Console API: Overview, command center and system health.
 * (Split out of super-admin.controller.ts, which re-exports it; handler code is unchanged.)
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import { AppError } from '../../middleware/error.middleware';
import { getHealthReport } from '../../../lib/health';
import {} from '../../../services/audit/admin-audit.service';
import { ADMIN_DOMAINS, getCapabilitiesForRole } from '../../../config/admin-capabilities';
import { isPlatformOwnerShortId } from '../../../lib/platform-owner';

const DAY_MS = 24 * 60 * 60 * 1000;


// ─── GET /super-admin/me ──────────────────────────────────────────────────────
// Returns the caller's role + capability map so the console UI can gate
// navigation and controls without hardcoding role checks client-side.

export async function getMyCapabilities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = (req as { user?: { sub?: string } }).user?.sub;
    if (!userId) {
      next(new AppError(401, 'Not authenticated'));
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, shortId: true, isActive: true },
    });
    if (!user?.isActive) {
      next(new AppError(403, 'Access denied'));
      return;
    }
    const isOwner = user.role === 'SUPER_ADMIN' && isPlatformOwnerShortId(user.shortId);
    res.json({
      success: true,
      role: user.role,
      isOwner,
      capabilities: isOwner ? ADMIN_DOMAINS.map((d) => d.key) : getCapabilitiesForRole(user.role),
      domains: ADMIN_DOMAINS,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/overview ────────────────────────────────────────────────

export async function getExecutiveOverview(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const since24h = new Date(Date.now() - DAY_MS);
    const since7d = new Date(Date.now() - 7 * DAY_MS);

    const [
      totalUsers,
      activeUsers,
      newUsersToday,
      faceUsers,
      totalDna,
      totalVault,
      totalCerts,
      activeCerts,
      revokedCerts,
      totalLinks,
      activeLinks,
      revokedLinks,
      totalViews,
      totalDownloads,
      totalMonitors,
      activeMonitors,
      totalTep,
      activeTep,
      revokedTep,
      provenanceEvents,
      investigatedEvents,
      tamperedEvents,
      loginToday,
      sessionsToday,
      notifications,
      duplicateAttempts,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { createdAt: { gte: since24h } } }),
      prisma.user.count({ where: { faceRegistered: true } }),
      prisma.dnaRecord.count(),
      prisma.vaultRecord.count(),
      prisma.certificate.count(),
      prisma.certificate.count({ where: { status: 'ACTIVE' } }),
      prisma.certificate.count({ where: { status: 'REVOKED' } }),
      prisma.shareLink.count(),
      prisma.shareLink.count({ where: { isActive: true } }),
      prisma.shareLink.count({ where: { isActive: false } }),
      prisma.shareAccessLog.count(),
      prisma.shareAccessLog.count({ where: { action: 'DOWNLOADED' } }),
      prisma.monitorRecord.count(),
      prisma.monitorRecord.count({ where: { status: 'ACTIVE' } }),
      prisma.trackedExportPackage.count(),
      prisma.trackedExportPackage.count({ where: { status: 'ACTIVE' } }),
      prisma.trackedExportPackage.count({ where: { status: 'REVOKED' } }),
      prisma.forensicProvenanceEvent.count().catch(() => 0),
      prisma.forensicProvenanceEvent.count({ where: { eventType: 'INVESTIGATED' } }).catch(() => 0),
      prisma.forensicProvenanceEvent.count({ where: { eventType: 'TAMPERED' } }).catch(() => 0),
      prisma.loginHistory.count({ where: { createdAt: { gte: since24h }, success: true } }),
      prisma.userSession.count({ where: { lastActiveAt: { gte: since24h } } }).catch(() => 0),
      prisma.notification.count({ where: { read: false } }),
      prisma.auditEvent.count({ where: { eventType: 'DUPLICATE_UPLOAD_ATTEMPT' } }).catch(() => 0),
    ]);

    const vaultAgg = await prisma.vaultRecord.aggregate({
      _sum: { originalSizeBytes: true, encryptedSizeBytes: true },
    });

    const orgCount = await prisma.user.groupBy({
      by: ['organization'],
      where: { organization: { not: null } },
    });

    const recentUsers = await prisma.user.count({ where: { createdAt: { gte: since7d } } });

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        newToday: newUsersToday,
        newWeek: recentUsers,
        biometric: faceUsers,
        organizations: orgCount.filter((o) => o.organization).length,
      },
      files: {
        dnaGenerated: totalDna,
        vaultFiles: totalVault,
        storageOriginalBytes: vaultAgg._sum.originalSizeBytes ?? 0,
        storageEncryptedBytes: vaultAgg._sum.encryptedSizeBytes ?? 0,
      },
      certificates: { total: totalCerts, active: activeCerts, revoked: revokedCerts },
      investigations: { total: investigatedEvents, tampered: tamperedEvents },
      sharing: {
        links: totalLinks,
        activeLinks,
        revokedLinks,
        views: totalViews,
        downloads: totalDownloads,
      },
      protectedDownloads: { tepPackages: totalTep, active: activeTep, revoked: revokedTep },
      monitoring: { total: totalMonitors, active: activeMonitors },
      security: {
        duplicateAttempts,
        activeSessionsToday: sessionsToday,
        loginsToday: loginToday,
        unreadNotifications: notifications,
      },
      provenance: { totalEvents: provenanceEvents },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/command-center ──────────────────────────────────────────
// Purpose-built summary for the new Executive Command Center UI. Kept separate
// from getExecutiveOverview so nothing that already reads /overview is touched.
//
// Marketplace/Exchange figures (GMV, orders, top categories) are intentionally
// omitted rather than faked — Exchange runs its own database and there is no
// cross-service data bridge for it yet (see PDF roadmap: Commerce admin is a
// Tier 2 item). Every other figure here is a real, live query against this DB.

function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function last7DayKeys(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    days.push(dayKey(new Date(Date.now() - i * DAY_MS)));
  }
  return days;
}

export async function getCommandCenterSummary(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const since7d = new Date(Date.now() - 7 * DAY_MS);
    const since14d = new Date(Date.now() - 14 * DAY_MS);

    const [
      totalUsers, usersLast7d, usersPrior7d,
      totalOrgs, orgsLast7d, orgsPrior7d,
      totalAssets, assetsLast7d, assetsPrior7d,
      totalDna, dnaLast7d, dnaPrior7d,
      openIncidents,
      investigatedCount, investigatedPrior7d,
      tamperedCount,
      crawlerDetections,
      billingFailedCount,
      revenueAgg,
      recentUsers, recentAssets, recentDna, recentBilling,
      recentActivity,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: since7d } } }),
      prisma.user.count({ where: { createdAt: { gte: since14d, lt: since7d } } }),
      prisma.organization.count(),
      prisma.organization.count({ where: { createdAt: { gte: since7d } } }),
      prisma.organization.count({ where: { createdAt: { gte: since14d, lt: since7d } } }),
      prisma.asset.count(),
      prisma.asset.count({ where: { createdAt: { gte: since7d } } }),
      prisma.asset.count({ where: { createdAt: { gte: since14d, lt: since7d } } }),
      prisma.dnaRecord.count(),
      prisma.dnaRecord.count({ where: { createdAt: { gte: since7d } } }),
      prisma.dnaRecord.count({ where: { createdAt: { gte: since14d, lt: since7d } } }),
      prisma.incident.count({ where: { status: 'OPEN' } }),
      prisma.forensicProvenanceEvent.count({ where: { eventType: 'INVESTIGATED' } }).catch(() => 0),
      prisma.forensicProvenanceEvent.count({ where: { eventType: 'INVESTIGATED', createdAt: { gte: since14d, lt: since7d } } }).catch(() => 0),
      prisma.forensicProvenanceEvent.count({ where: { eventType: 'TAMPERED' } }).catch(() => 0),
      prisma.forensicProvenanceEvent.count({ where: { eventType: 'CRAWLER_DETECTION' } }).catch(() => 0),
      prisma.billingHistory.count({ where: { status: 'FAILED' } }).catch(() => 0),
      prisma.billingHistory.aggregate({ where: { status: 'SUCCEEDED' }, _sum: { amountCents: true } }).catch(() => ({ _sum: { amountCents: 0 } })),
      prisma.user.findMany({ where: { createdAt: { gte: since7d } }, select: { createdAt: true } }),
      prisma.asset.findMany({ where: { createdAt: { gte: since7d } }, select: { createdAt: true } }),
      prisma.dnaRecord.findMany({ where: { createdAt: { gte: since7d } }, select: { createdAt: true } }),
      prisma.billingHistory.findMany({ where: { createdAt: { gte: since7d }, status: 'SUCCEEDED' }, select: { createdAt: true, amountCents: true } }).catch(() => []),
      prisma.forensicProvenanceEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, eventType: true, summary: true, createdAt: true, actorLabel: true },
      }).catch(() => []),
    ]);

    // ── 7-day activity series (bucketed in JS — small dev datasets, no raw SQL) ──
    const days = last7DayKeys();
    const bucket = <T extends { createdAt: Date }>(rows: T[]) => {
      const counts = new Map(days.map((d) => [d, 0]));
      for (const row of rows) {
        const key = dayKey(row.createdAt);
        if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    };
    const userBuckets = bucket(recentUsers);
    const assetBuckets = bucket(recentAssets);
    const dnaBuckets = bucket(recentDna);
    const revenueBuckets = new Map(days.map((d) => [d, 0]));
    for (const row of recentBilling as { createdAt: Date; amountCents: number }[]) {
      const key = dayKey(row.createdAt);
      if (revenueBuckets.has(key)) revenueBuckets.set(key, (revenueBuckets.get(key) ?? 0) + row.amountCents);
    }

    const activityOverview = days.map((date) => ({
      date,
      users: userBuckets.get(date) ?? 0,
      assets: assetBuckets.get(date) ?? 0,
      dnaProtected: dnaBuckets.get(date) ?? 0,
      revenueCents: revenueBuckets.get(date) ?? 0,
    }));

    // ── Sentinel breakdown — real ForensicProvenanceEvent categories, not the
    // vector taxonomy from the mockup (that classification isn't persisted). ──
    const totalInvestigations = investigatedCount + tamperedCount + crawlerDetections;
    const sentinelBreakdown = [
      { label: 'Investigated', count: investigatedCount },
      { label: 'Tampered', count: tamperedCount },
      { label: 'Crawler Detections', count: crawlerDetections },
    ]
      .filter((b) => b.count > 0)
      .map((b) => ({ ...b, pct: totalInvestigations > 0 ? Math.round((b.count / totalInvestigations) * 1000) / 10 : 0 }));

    // ── Alerts — derived from real, currently-measurable signals only ──
    const alerts: { id: string; severity: 'warning' | 'critical'; title: string; detail: string }[] = [];
    if (openIncidents > 0) {
      alerts.push({
        id: 'open-incidents',
        severity: openIncidents > 20 ? 'critical' : 'warning',
        title: `${openIncidents} open incident${openIncidents === 1 ? '' : 's'}`,
        detail: 'Incidents awaiting triage or resolution',
      });
    }
    if (billingFailedCount > 0) {
      alerts.push({
        id: 'failed-payments',
        severity: 'warning',
        title: `${billingFailedCount} failed payment${billingFailedCount === 1 ? '' : 's'}`,
        detail: 'Billing charges that did not succeed',
      });
    }
    if (tamperedCount > 0) {
      alerts.push({
        id: 'tampered-files',
        severity: 'warning',
        title: `${tamperedCount} tamper event${tamperedCount === 1 ? '' : 's'} logged`,
        detail: 'Files flagged as tampered by investigations',
      });
    }

    res.json({
      kpis: {
        totalUsers,
        totalUsersDeltaPct: pctDelta(usersLast7d, usersPrior7d),
        organizations: totalOrgs,
        organizationsDeltaPct: pctDelta(orgsLast7d, orgsPrior7d),
        totalAssets,
        totalAssetsDeltaPct: pctDelta(assetsLast7d, assetsPrior7d),
        dnaProtected: totalDna,
        dnaProtectedDeltaPct: pctDelta(dnaLast7d, dnaPrior7d),
        marketplaceGmvCents: null,
        platformRevenueCents: revenueAgg._sum.amountCents ?? 0,
      },
      activityOverview,
      sentinel: {
        totalInvestigations,
        totalInvestigationsDeltaPct: pctDelta(investigatedCount - investigatedPrior7d >= 0 ? investigatedCount : 0, investigatedPrior7d),
        breakdown: sentinelBreakdown,
      },
      activityFeed: recentActivity.map((e) => ({
        id: e.id,
        type: e.eventType,
        summary: e.summary,
        actor: e.actorLabel,
        createdAt: e.createdAt,
      })),
      alerts,
      revenueBreakdown: [
        { label: 'Subscriptions', amountCents: revenueAgg._sum.amountCents ?? 0 },
      ],
      marketplaceAvailable: false,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/health ──────────────────────────────────────────────────

export async function getSystemHealth(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const report = await getHealthReport();
    res.json(report);
  } catch (err) {
    next(err);
  }
}
