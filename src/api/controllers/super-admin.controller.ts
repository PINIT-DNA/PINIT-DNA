/**
 * PINIT-DNA — Super Admin Console API
 *
 * Cross-tenant visibility for SUPER_ADMIN only.
 * Does not modify tenant-scoped user APIs.
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { getHealthReport } from '../../lib/health';
import { adminAuditService } from '../../services/audit/admin-audit.service';
import { ADMIN_DOMAINS, getCapabilitiesForRole, getRoleCapabilityMatrix } from '../../config/admin-capabilities';
import { isPlatformOwnerShortId } from '../../lib/platform-owner';
import { extractPinitCode, toRootPinitId, toUserPinitId, toOrgPinitId, toExchangePinitId } from '../../lib/pinit-identity';

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

// ─── GET /super-admin/organizations ───────────────────────────────────────────

export async function listAllOrganizations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const organizations = await prisma.organization.findMany({
      where: q
        ? {
            OR: [
              { shortId: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { country: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      select: {
        id: true,
        shortId: true,
        name: true,
        industry: true,
        organizationSize: true,
        country: true,
        createdAt: true,
        ownerUser: { select: { shortId: true, fullName: true, email: true } },
        _count: { select: { members: true, campaigns: true, clients: true, dnaRecords: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    res.json({ organizations, total: organizations.length });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/organizations/:id ───────────────────────────────────────

export async function getOrganizationProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.params.id },
      include: {
        ownerUser: { select: { id: true, shortId: true, fullName: true, email: true, role: true } },
        members: {
          select: {
            id: true,
            role: true,
            joinedAt: true,
            user: { select: { id: true, shortId: true, fullName: true, email: true } },
            department: { select: { id: true, name: true } },
          },
          orderBy: { joinedAt: 'desc' },
        },
        departments: { select: { id: true, name: true, createdAt: true } },
        workspaces: { select: { id: true, name: true, createdAt: true } },
        clients: { select: { id: true, name: true, companyName: true, createdAt: true } },
        campaigns: {
          select: { id: true, name: true, status: true, startDate: true, endDate: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        _count: {
          select: {
            members: true, campaigns: true, clients: true, dnaRecords: true,
            apiKeys: true, webhooks: true, integrations: true, auditLogs: true,
          },
        },
      },
    });

    if (!org) {
      next(new AppError(404, 'Organization not found'));
      return;
    }

    res.json({ ...org, identity: resolvePinitIdentity(org.shortId) });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/users ───────────────────────────────────────────────────

export async function listAllUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const role = typeof req.query.role === 'string' ? req.query.role : undefined;
    const active = req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined;

    const users = await prisma.user.findMany({
      where: {
        ...(role ? { role: role as never } : {}),
        ...(active !== undefined ? { isActive: active } : {}),
        ...(q
          ? {
              OR: [
                { shortId: { contains: q, mode: 'insensitive' } },
                { fullName: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { organization: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        shortId: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        faceRegistered: true,
        organization: true,
        country: true,
        createdAt: true,
        lastLoginAt: true,
        _count: {
          select: {
            dnaRecords: true,
            shareLinks: true,
            certificates: true,
            loginHistory: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    res.json({ users, total: users.length });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/users/:id ───────────────────────────────────────────────

export async function getUserProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        shortId: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        authMethod: true,
        faceRegistered: true,
        faceRegisteredAt: true,
        createdAt: true,
        lastLoginAt: true,
        organization: true,
        phone: true,
        country: true,
        jobTitle: true,
        bio: true,
        dnaRecords: {
          select: {
            id: true,
            imageFilename: true,
            imageMimeType: true,
            imageSizeBytes: true,
            fileType: true,
            sha256Hash: true,
            status: true,
            createdAt: true,
            vaultRecord: {
              select: {
                id: true,
                encryptedSizeBytes: true,
                originalSizeBytes: true,
                encryptionAlgorithm: true,
                createdAt: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        shareLinks: {
          select: {
            id: true,
            token: true,
            filename: true,
            isActive: true,
            viewCount: true,
            downloadCount: true,
            createdAt: true,
            expiresAt: true,
            _count: { select: { accessLogs: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        certificates: {
          select: {
            id: true,
            certificateId: true,
            status: true,
            createdAt: true,
            revokedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        loginHistory: {
          select: {
            id: true,
            method: true,
            ip: true,
            device: true,
            browser: true,
            os: true,
            city: true,
            country: true,
            success: true,
            failReason: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        monitorRecords: {
          select: {
            id: true,
            status: true,
            scanType: true,
            createdAt: true,
            lastCheckedAt: true,
          },
          take: 20,
        },
        userSessions: {
          select: {
            id: true, createdAt: true, ip: true, userAgent: true,
            expiresAt: true, revokedAt: true, lastActiveAt: true, deviceId: true,
          },
          orderBy: { lastActiveAt: 'desc' },
          take: 30,
        },
        userDevices: {
          select: {
            id: true, deviceLabel: true, deviceFingerprint: true,
            isTrusted: true, registeredAt: true, lastSeenAt: true,
          },
          orderBy: { lastSeenAt: 'desc' },
          take: 30,
        },
      },
    });

    if (!user) {
      next(new AppError(404, 'User not found'));
      return;
    }

    const tepPackages = await prisma.trackedExportPackage.findMany({
      where: { ownerUserId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ ...user, tepPackages, identity: resolvePinitIdentity(user.shortId) });
  } catch (err) {
    next(err);
  }
}

// ─── Identity resolver ─────────────────────────────────────────────────────
// Deterministic PINIT-ID join across the Root / Individual / Business / Exchange
// account labels a single person can hold — see lib/pinit-identity.ts. Exchange
// runs its own database with no query bridge yet, so this resolves what the
// person's Exchange-side id *would be*; it does not confirm an Exchange account
// exists or fetch Exchange data. That is the honest scope of "the join" today.

function resolvePinitIdentity(shortId: string) {
  const code = extractPinitCode(shortId);
  return {
    code,
    root: toRootPinitId(code),
    individual: toUserPinitId(code),
    business: toOrgPinitId(code),
    exchange: toExchangePinitId(code),
  };
}

// ─── GET /super-admin/search ───────────────────────────────────────────────

export async function globalSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2) {
      res.json({ query: q, results: [] });
      return;
    }

    const code = extractPinitCode(q);
    const idVariants = code ? [toRootPinitId(code), toUserPinitId(code), toOrgPinitId(code), toExchangePinitId(code)] : [];

    const [users, orgs, dnaRecords] = await Promise.all([
      prisma.user.findMany({
        where: {
          OR: [
            ...(idVariants.length ? [{ shortId: { in: idVariants } }] : []),
            { shortId: { contains: q, mode: 'insensitive' as const } },
            { fullName: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
          ],
        },
        select: { id: true, shortId: true, fullName: true, email: true, role: true },
        take: 6,
      }),
      prisma.organization.findMany({
        where: {
          OR: [
            ...(idVariants.length ? [{ shortId: { in: idVariants } }] : []),
            { shortId: { contains: q, mode: 'insensitive' as const } },
            { name: { contains: q, mode: 'insensitive' as const } },
          ],
        },
        select: { id: true, shortId: true, name: true },
        take: 6,
      }),
      prisma.dnaRecord.findMany({
        where: {
          OR: [
            { id: q },
            { imageFilename: { contains: q, mode: 'insensitive' as const } },
            { sha256Hash: { startsWith: q } },
          ],
        },
        select: { id: true, imageFilename: true, fileType: true, status: true, ownerUser: { select: { shortId: true } } },
        take: 6,
      }),
    ]);

    res.json({
      query: q,
      results: [
        ...users.map((u) => ({
          type: 'user' as const,
          id: u.id,
          title: u.fullName ?? u.shortId,
          subtitle: `${u.shortId}${u.email ? ` · ${u.email}` : ''} · ${u.role}`,
          href: `/users/${u.id}`,
        })),
        ...orgs.map((o) => ({
          type: 'organization' as const,
          id: o.id,
          title: o.name ?? o.shortId,
          subtitle: o.shortId,
          href: `/organizations/${o.id}`,
        })),
        ...dnaRecords.map((d) => ({
          type: 'asset' as const,
          id: d.id,
          title: d.imageFilename,
          subtitle: `${d.fileType ?? 'FILE'} · ${d.status} · owner ${d.ownerUser?.shortId ?? '—'}`,
          href: `/dna?highlight=${d.id}`,
        })),
      ],
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/vault ───────────────────────────────────────────────────

export async function listAllVault(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const files = await prisma.vaultRecord.findMany({
      where: q
        ? {
            OR: [
              { originalFileName: { contains: q, mode: 'insensitive' } },
              { dnaRecord: { ownerUser: { shortId: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : undefined,
      select: {
        id: true,
        originalFileName: true,
        originalMimeType: true,
        originalSizeBytes: true,
        encryptedSizeBytes: true,
        encryptionAlgorithm: true,
        createdAt: true,
        dnaRecord: {
          select: {
            id: true,
            sha256Hash: true,
            fileType: true,
            status: true,
            ownerUserId: true,
            ownerUser: {
              select: { shortId: true, fullName: true, email: true, organization: true, country: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const totalSize = files.reduce((s, f) => s + f.originalSizeBytes, 0);
    res.json({ files, total: files.length, totalSize });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/files ───────────────────────────────────────────────────

export async function listAllFiles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fileType = typeof req.query.fileType === 'string' ? req.query.fileType : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const records = await prisma.dnaRecord.findMany({
      where: {
        ...(fileType ? { fileType } : {}),
        ...(q
          ? {
              OR: [
                { imageFilename: { contains: q, mode: 'insensitive' } },
                { sha256Hash: { contains: q, mode: 'insensitive' } },
                { ownerUser: { shortId: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        imageFilename: true,
        imageMimeType: true,
        imageSizeBytes: true,
        fileType: true,
        sha256Hash: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        ownerUser: {
          select: { id: true, shortId: true, fullName: true, organization: true, country: true },
        },
        vaultRecord: { select: { id: true, encryptionAlgorithm: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    res.json({ files: records, total: records.length });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/dna ─────────────────────────────────────────────────────

export async function listAllDna(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const records = await prisma.dnaRecord.findMany({
      where: status ? { status: status as never } : undefined,
      select: {
        id: true,
        imageFilename: true,
        fileType: true,
        status: true,
        sha256Hash: true,
        createdAt: true,
        ownerUser: { select: { shortId: true, fullName: true } },
        vaultRecord: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    res.json({ records, total: records.length });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/certificates ────────────────────────────────────────────

export async function listAllCertificates(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const certs = await prisma.certificate.findMany({
      where: status ? { status: status as never } : undefined,
      select: {
        id: true,
        certificateId: true,
        status: true,
        createdAt: true,
        revokedAt: true,
        dnaRecordId: true,
        vaultId: true,
        ownerUser: { select: { shortId: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const dnaIds = [...new Set(certs.map((c) => c.dnaRecordId))];
    const vaultIds = [...new Set(certs.map((c) => c.vaultId))];
    const [dnaRows, vaultRows] = await Promise.all([
      dnaIds.length
        ? prisma.dnaRecord.findMany({
            where: { id: { in: dnaIds } },
            select: { id: true, imageFilename: true, fileType: true },
          })
        : [],
      vaultIds.length
        ? prisma.vaultRecord.findMany({
            where: { id: { in: vaultIds } },
            select: {
              id: true,
              dnaRecordId: true,
              originalFileName: true,
              originalMimeType: true,
              originalSizeBytes: true,
              encryptedSizeBytes: true,
              encryptionAlgorithm: true,
              keyDerivation: true,
              createdAt: true,
            },
          })
        : [],
    ]);
    const dnaMap = new Map(dnaRows.map((d) => [d.id, d]));
    const vaultMap = new Map(vaultRows.map((v) => [v.id, v]));

    res.json({
      certificates: certs.map((c) => ({
        ...c,
        dnaRecord: dnaMap.get(c.dnaRecordId) ?? null,
        vaultRecord: vaultMap.get(c.vaultId) ?? null,
      })),
      total: certs.length,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/investigations ──────────────────────────────────────────

export async function listInvestigations(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    let events: unknown[] = [];
    try {
      events = await prisma.forensicProvenanceEvent.findMany({
        where: { eventType: { in: ['INVESTIGATED', 'TAMPERED'] } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    } catch {
      events = [];
    }
    res.json({ investigations: events, total: events.length });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/tracking ────────────────────────────────────────────────

export async function listTrackingEvents(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [downloads, tepPackages, accessLogs] = await Promise.all([
      prisma.forensicProvenanceEvent
        .findMany({
          where: { eventType: { in: ['DOWNLOADED', 'PROTECTED_EXPORT', 'TEP_CREATED'] } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
        .catch(() => []),
      prisma.trackedExportPackage.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          dnaRecord: { select: { imageFilename: true } },
        },
      }),
      prisma.shareAccessLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          shareLink: {
            select: {
              filename: true,
              ownerUser: { select: { shortId: true } },
            },
          },
        },
      }),
    ]);

    res.json({ downloads, tepPackages, accessLogs });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/monitoring ──────────────────────────────────────────────

export async function listMonitoring(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [monitors, alerts, runs] = await Promise.all([
      prisma.monitorRecord.findMany({
        include: {
          ownerUser: { select: { shortId: true, fullName: true } },
          dnaRecord: { select: { imageFilename: true, fileType: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.crawlResult.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          monitorRecord: {
            select: {
              ownerUser: { select: { shortId: true } },
            },
          },
        },
      }),
      prisma.monitoringRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 50,
      }).catch(() => []),
    ]);

    res.json({ monitors, alerts, runs });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/analytics ───────────────────────────────────────────────

export async function getAnalytics(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const since30d = new Date(Date.now() - 30 * DAY_MS);

    const [usersByDay, dnaByDay, topCountries, topCities] = await Promise.all([
      prisma.user.findMany({
        where: { createdAt: { gte: since30d } },
        select: { createdAt: true },
      }),
      prisma.dnaRecord.findMany({
        where: { createdAt: { gte: since30d } },
        select: { createdAt: true, fileType: true },
      }),
      prisma.loginHistory.groupBy({
        by: ['country'],
        where: { country: { not: null }, createdAt: { gte: since30d } },
        _count: { country: true },
        orderBy: { _count: { country: 'desc' } },
        take: 20,
      }),
      prisma.loginHistory.groupBy({
        by: ['city'],
        where: { city: { not: null }, createdAt: { gte: since30d } },
        _count: { city: true },
        orderBy: { _count: { city: 'desc' } },
        take: 20,
      }),
    ]);

    const fileTypeBreakdown = dnaByDay.reduce<Record<string, number>>((acc, r) => {
      const t = r.fileType ?? 'UNKNOWN';
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});

    res.json({
      growth: {
        users: usersByDay.length,
        dna: dnaByDay.length,
      },
      fileTypes: fileTypeBreakdown,
      geo: {
        countries: topCountries.map((c) => ({ name: c.country, count: c._count.country })),
        cities: topCities.map((c) => ({ name: c.city, count: c._count.city })),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/activity ────────────────────────────────────────────────

export async function getRecentActivity(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const [logins, uploads, investigations, downloads] = await Promise.all([
      prisma.loginHistory.findMany({
        select: {
          id: true,
          method: true,
          ip: true,
          country: true,
          city: true,
          success: true,
          createdAt: true,
          user: { select: { shortId: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.dnaRecord.findMany({
        select: {
          id: true,
          imageFilename: true,
          fileType: true,
          createdAt: true,
          ownerUser: { select: { shortId: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.forensicProvenanceEvent
        .findMany({
          where: { eventType: 'INVESTIGATED' },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
        .catch(() => []),
      prisma.forensicProvenanceEvent
        .findMany({
          where: { eventType: 'DOWNLOADED' },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
        .catch(() => []),
    ]);

    res.json({ logins, uploads, investigations, downloads });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/audit ───────────────────────────────────────────────────

async function enrichDuplicateAttempts(
  events: Array<{
    id: string;
    eventType: string;
    userId: string | null;
    filename: string | null;
    fileType: string | null;
    ipAddress: string | null;
    browser: string | null;
    os: string | null;
    device: string | null;
    createdAt: Date;
    detail: unknown;
  }>,
) {
  const userIds = new Set<string>();
  for (const e of events) {
    if (e.userId) userIds.add(e.userId);
    const d = (e.detail ?? {}) as Record<string, string>;
    if (d.uploaderUserId) userIds.add(d.uploaderUserId);
    if (d.ownerUserId) userIds.add(d.ownerUserId);
  }

  const users = userIds.size
    ? await prisma.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, shortId: true, fullName: true, email: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  return events.map((e) => {
    const detail = (e.detail ?? {}) as Record<string, unknown>;
    const uploaderId = e.userId ?? (detail.uploaderUserId as string | undefined);
    const ownerId = detail.ownerUserId as string | undefined;
    const uploader = uploaderId ? userMap.get(uploaderId) : undefined;
    const owner = ownerId ? userMap.get(ownerId) : undefined;

    return {
      id: e.id,
      eventType: e.eventType,
      createdAt: e.createdAt,
      filename: e.filename,
      fileType: e.fileType,
      ipAddress: e.ipAddress,
      browser: e.browser,
      os: e.os,
      device: e.device,
      matchType: detail.matchType ?? null,
      riskLevel: detail.riskLevel ?? null,
      existingFilename: detail.existingFilename ?? null,
      existingDnaRecordId: detail.existingDnaRecordId ?? null,
      pHashSimilarity: detail.pHashSimilarity ?? null,
      uploader: uploader
        ? { id: uploader.id, shortId: uploader.shortId, fullName: uploader.fullName }
        : detail.uploaderShortId
          ? { id: uploaderId ?? null, shortId: detail.uploaderShortId, fullName: null }
          : null,
      originalOwner: owner
        ? { id: owner.id, shortId: owner.shortId, fullName: owner.fullName }
        : detail.ownerShortId
          ? { id: ownerId ?? null, shortId: detail.ownerShortId, fullName: null }
          : null,
    };
  });
}

// ─── GET /super-admin/admin-audit ─────────────────────────────────────────────
// "Who changed what" for super-admin console actions — distinct from
// getAuditLogs below, which covers logins/share-access/duplicate uploads.

export async function getAdminAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query['limit']) || 100));
    const events = await adminAuditService.list({
      limit,
      actorUserId: typeof req.query['actorUserId'] === 'string' ? req.query['actorUserId'] : undefined,
      action: typeof req.query['action'] === 'string' ? req.query['action'] : undefined,
      targetType: typeof req.query['targetType'] === 'string' ? req.query['targetType'] : undefined,
    });
    res.json({ success: true, count: events.length, events });
  } catch (err) {
    next(err);
  }
}

export async function getAuditLogs(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawDuplicates = await prisma.auditEvent
      .findMany({
        where: { eventType: 'DUPLICATE_UPLOAD_ATTEMPT' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      .catch(() => []);

    const [logins, shareAccess, duplicateAttempts] = await Promise.all([
      prisma.loginHistory.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { user: { select: { shortId: true, fullName: true } } },
      }),
      prisma.shareAccessLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          shareLink: {
            select: { filename: true, ownerUser: { select: { shortId: true } } },
          },
        },
      }),
      enrichDuplicateAttempts(rawDuplicates),
    ]);

    res.json({ logins, shareAccess, duplicateAttempts });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/vault/:id/intelligence ──────────────────────────────────

export async function getAdminVaultIntelligence(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { buildIntelligenceReportPayload } = await import('../../services/intelligence/intelligence-report.builder');
    const payload = await buildIntelligenceReportPayload(req.params.id);
    if (!payload) {
      next(new AppError(404, 'Vault record not found'));
      return;
    }
    res.json({ success: true, ...payload });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/vault/:id/tracking ────────────────────────────────────────

export async function getAdminVaultTracking(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const vault = await prisma.vaultRecord.findUnique({
      where: { id: req.params.id },
      include: { dnaRecord: { select: { ownerUserId: true } } },
    });
    if (!vault?.dnaRecord?.ownerUserId) {
      next(new AppError(404, 'Vault record not found'));
      return;
    }
    const { getVaultTrackingDashboard } = await import('../../services/provenance');
    const tracking = await getVaultTrackingDashboard({
      vaultId: vault.id,
      ownerUserId: vault.dnaRecord.ownerUserId,
    });
    res.json({ success: true, tracking });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/vault/:id/shares ────────────────────────────────────────

export async function getAdminVaultShares(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const links = await prisma.shareLink.findMany({
      where: { vaultId: req.params.id },
      include: {
        ownerUser: { select: { shortId: true, fullName: true } },
        accessLogs: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, links });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/vault/:id/timeline ──────────────────────────────────────

export async function getAdminVaultTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const vault = await prisma.vaultRecord.findUnique({
      where: { id: req.params.id },
      select: { id: true, dnaRecordId: true, originalFileName: true },
    });
    if (!vault) {
      next(new AppError(404, 'Vault record not found'));
      return;
    }
    const { loadEvidenceTimeline, loadDownloadHistory } = await import('../../services/provenance/timeline.service');
    const [timeline, downloads, auditEvents] = await Promise.all([
      loadEvidenceTimeline({ dnaRecordId: vault.dnaRecordId, vaultId: vault.id }),
      loadDownloadHistory({ dnaRecordId: vault.dnaRecordId, vaultId: vault.id }),
      prisma.auditEvent.findMany({
        where: { dnaRecordId: vault.dnaRecordId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    res.json({ success: true, vault, timeline, downloads, auditEvents });
  } catch (err) {
    next(err);
  }
}

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

// ─── Verification Requests (manual KYC, reviewed via this console) ────────
// There is no self-serve submission flow in the main app yet, so requests
// are logged here by an admin (e.g. after a phone call or emailed documents)
// and then reviewed/decided here too.

export async function listVerificationRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const [requests, pendingCount, approvedCount, rejectedCount] = await Promise.all([
      prisma.verificationRequest.findMany({
        where: { status },
        include: { user: { select: { id: true, shortId: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.verificationRequest.count({ where: { status: 'PENDING' } }),
      prisma.verificationRequest.count({ where: { status: 'APPROVED' } }),
      prisma.verificationRequest.count({ where: { status: 'REJECTED' } }),
    ]);

    const reviewerIds = [...new Set(requests.map((r) => r.reviewedByUserId).filter((v): v is string => !!v))];
    const reviewers = reviewerIds.length
      ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, shortId: true, fullName: true } })
      : [];
    const reviewerById = new Map(reviewers.map((r) => [r.id, r]));

    res.json({
      success: true,
      requests: requests.map((r) => ({
        ...r,
        reviewer: r.reviewedByUserId ? reviewerById.get(r.reviewedByUserId) ?? null : null,
      })),
      total: requests.length,
      pendingCount,
      approvedCount,
      rejectedCount,
    });
  } catch (err) {
    next(err);
  }
}

export async function createVerificationRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, shortId, requestType, documentType, submittedNote } = req.body as {
      userId?: string; shortId?: string; requestType?: string; documentType?: string; submittedNote?: string;
    };
    if (!userId && !shortId) {
      next(new AppError(400, 'userId or shortId is required'));
      return;
    }
    const user = await prisma.user.findUnique({
      where: userId ? { id: userId } : { shortId: shortId!.trim().toUpperCase() },
      select: { id: true, shortId: true },
    });
    if (!user) {
      next(new AppError(404, 'User not found'));
      return;
    }

    const created = await prisma.verificationRequest.create({
      data: {
        userId: user.id,
        requestType: requestType || 'IDENTITY',
        documentType: documentType || null,
        submittedNote: submittedNote || null,
      },
      include: { user: { select: { id: true, shortId: true, fullName: true, email: true } } },
    });

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: 'verification.request_logged',
        targetType: 'VerificationRequest',
        targetId: created.id,
        after: { userId: user.id, requestType: created.requestType },
        req,
      });
    }

    res.status(201).json({ success: true, request: created });
  } catch (err) {
    next(err);
  }
}

export async function reviewVerificationRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { decision, reviewNote } = req.body as { decision?: string; reviewNote?: string };
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      next(new AppError(400, 'decision must be APPROVED or REJECTED'));
      return;
    }

    const existing = await prisma.verificationRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      next(new AppError(404, 'Verification request not found'));
      return;
    }
    if (existing.status !== 'PENDING') {
      next(new AppError(409, `Request already decided (${existing.status})`));
      return;
    }

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    const updated = await prisma.verificationRequest.update({
      where: { id: req.params.id },
      data: {
        status: decision,
        reviewedByUserId: actor?.sub ?? null,
        reviewedAt: new Date(),
        reviewNote: reviewNote || null,
      },
      include: { user: { select: { id: true, shortId: true, fullName: true, email: true } } },
    });

    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: decision === 'APPROVED' ? 'verification.approved' : 'verification.rejected',
        targetType: 'VerificationRequest',
        targetId: updated.id,
        before: { status: existing.status },
        after: { status: updated.status, reviewNote: updated.reviewNote },
        req,
      });
    }

    res.json({ success: true, request: updated });
  } catch (err) {
    next(err);
  }
}

// ─── Support Tickets & Disputes ────────────────────────────────────────────
// No self-serve submission flow in the main app yet — admins log tickets on
// a user's behalf (e.g. after an email/support-channel conversation), then
// respond and resolve here. "Dispute" is just category: 'DISPUTE'.

export async function listSupportTickets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const category = typeof req.query['category'] === 'string' ? req.query['category'] : undefined;

    const [tickets, openCount, disputeCount, resolvedCount] = await Promise.all([
      prisma.supportTicket.findMany({
        where: { status, category },
        include: {
          user: { select: { id: true, shortId: true, fullName: true, email: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      prisma.supportTicket.count({ where: { category: 'DISPUTE', status: { not: 'RESOLVED' } } }),
      prisma.supportTicket.count({ where: { status: 'RESOLVED' } }),
    ]);

    res.json({
      success: true,
      tickets: tickets.map((t) => ({ ...t, messageCount: t._count.messages, _count: undefined })),
      total: tickets.length,
      openCount,
      disputeCount,
      resolvedCount,
    });
  } catch (err) {
    next(err);
  }
}

export async function getSupportTicketDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, shortId: true, fullName: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) {
      next(new AppError(404, 'Ticket not found'));
      return;
    }
    res.json({ success: true, ticket });
  } catch (err) {
    next(err);
  }
}

export async function createSupportTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, shortId, subject, category, priority, description } = req.body as {
      userId?: string; shortId?: string; subject?: string; category?: string; priority?: string; description?: string;
    };
    if (!subject || !description) {
      next(new AppError(400, 'subject and description are required'));
      return;
    }
    if (!userId && !shortId) {
      next(new AppError(400, 'userId or shortId is required'));
      return;
    }
    const user = await prisma.user.findUnique({
      where: userId ? { id: userId } : { shortId: shortId!.trim().toUpperCase() },
      select: { id: true, shortId: true },
    });
    if (!user) {
      next(new AppError(404, 'User not found'));
      return;
    }

    const created = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        subject,
        description,
        category: category || 'GENERAL',
        priority: priority || 'NORMAL',
      },
      include: { user: { select: { id: true, shortId: true, fullName: true, email: true } } },
    });

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: 'support.ticket_opened',
        targetType: 'SupportTicket',
        targetId: created.id,
        after: { userId: user.id, subject, category: created.category },
        req,
      });
    }

    res.status(201).json({ success: true, ticket: { ...created, messageCount: 0 } });
  } catch (err) {
    next(err);
  }
}

export async function addSupportTicketMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { body, isInternal } = req.body as { body?: string; isInternal?: boolean };
    if (!body) {
      next(new AppError(400, 'body is required'));
      return;
    }
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!ticket) {
      next(new AppError(404, 'Ticket not found'));
      return;
    }

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    const [message] = await prisma.$transaction([
      prisma.supportTicketMessage.create({
        data: {
          ticketId: ticket.id,
          authorUserId: actor?.sub ?? null,
          authorLabel: actor?.shortId ?? 'Admin',
          body,
          isInternal: !!isInternal,
        },
      }),
      prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { status: ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status },
      }),
    ]);

    res.status(201).json({ success: true, message });
  } catch (err) {
    next(err);
  }
}

export async function resolveSupportTicket(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { resolutionNote } = req.body as { resolutionNote?: string };
    const existing = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      next(new AppError(404, 'Ticket not found'));
      return;
    }

    const actor = (req as { user?: { sub?: string; shortId?: string } }).user;
    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: {
        status: 'RESOLVED',
        resolvedByUserId: actor?.sub ?? null,
        resolvedAt: new Date(),
        resolutionNote: resolutionNote || null,
      },
      include: { user: { select: { id: true, shortId: true, fullName: true, email: true } } },
    });

    if (actor?.sub) {
      res.locals['adminAuditRecorded'] = true;
      await adminAuditService.record({
        actorUserId: actor.sub,
        actorShortId: actor.shortId ?? null,
        action: 'support.ticket_resolved',
        targetType: 'SupportTicket',
        targetId: updated.id,
        before: { status: existing.status },
        after: { status: updated.status, resolutionNote: updated.resolutionNote },
        req,
      });
    }

    res.json({ success: true, ticket: updated });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/network-overview ─────────────────────────────────────
// Organizational network reach — members, clients, campaigns, assets per
// org. Not a graph engine; a ranked structural view of existing relational
// data (Organization → Client → Campaign → Asset).

export async function getNetworkOverview(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const organizations = await prisma.organization.findMany({
      include: {
        ownerUser: { select: { shortId: true, fullName: true } },
        _count: { select: { members: true, clients: true, campaigns: true, dnaRecords: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const ranked = organizations
      .map((o) => ({
        id: o.id,
        shortId: o.shortId,
        name: o.name,
        industry: o.industry,
        owner: o.ownerUser,
        members: o._count.members,
        clients: o._count.clients,
        campaigns: o._count.campaigns,
        assets: o._count.dnaRecords,
        networkSize: o._count.members + o._count.clients + o._count.campaigns,
      }))
      .sort((a, b) => b.networkSize - a.networkSize);

    const totals = ranked.reduce(
      (acc, o) => ({
        members: acc.members + o.members,
        clients: acc.clients + o.clients,
        campaigns: acc.campaigns + o.campaigns,
      }),
      { members: 0, clients: 0, campaigns: 0 },
    );

    res.json({ success: true, organizations: ranked, totals, totalOrganizations: ranked.length });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/usage-overview ───────────────────────────────────────
// Real live storage consumption per user against their plan's limit —
// computed from VaultRecord, not the (currently unpopulated) UsageRecord
// metering ledger, since nothing in the codebase writes to that table yet.

export async function getUsageOverview(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [subscriptions, vaultByOwner] = await Promise.all([
      prisma.subscription.findMany({
        include: {
          user: { select: { id: true, shortId: true, fullName: true } },
          plan: { select: { code: true, name: true, storageLimitBytes: true } },
        },
      }),
      prisma.vaultRecord.findMany({
        select: { encryptedSizeBytes: true, dnaRecord: { select: { ownerUserId: true } } },
      }),
    ]);

    const usageByOwner = new Map<string, number>();
    for (const v of vaultByOwner) {
      const ownerId = v.dnaRecord?.ownerUserId;
      if (!ownerId) continue;
      usageByOwner.set(ownerId, (usageByOwner.get(ownerId) ?? 0) + v.encryptedSizeBytes);
    }

    const rows = subscriptions.map((s) => {
      const usedBytes = usageByOwner.get(s.userId) ?? 0;
      const limitBytes = s.plan.storageLimitBytes;
      return {
        userId: s.userId,
        user: s.user,
        planCode: s.plan.code,
        planName: s.plan.name,
        usedBytes: usedBytes.toString(),
        limitBytes: limitBytes ? limitBytes.toString() : null,
        usagePct: limitBytes && limitBytes > 0n ? Number((BigInt(usedBytes) * 10000n) / limitBytes) / 100 : null,
      };
    });

    const totalUsedBytes = rows.reduce((s, r) => s + Number(r.usedBytes), 0);
    const nearLimitCount = rows.filter((r) => r.usagePct != null && r.usagePct >= 80).length;

    res.json({
      success: true,
      usage: rows.sort((a, b) => Number(b.usedBytes) - Number(a.usedBytes)),
      totalUsedBytes,
      nearLimitCount,
      metered: {
        // Honest signal to the UI that the formal per-metric ledger is empty.
        usageRecordCount: await prisma.usageRecord.count(),
      },
    });
  } catch (err) {
    next(err);
  }
}
