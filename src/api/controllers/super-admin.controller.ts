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

const DAY_MS = 24 * 60 * 60 * 1000;

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

    res.json({ ...user, tepPackages });
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
    const { role } = req.body as { role?: string };
    const allowed = ['SUPER_ADMIN', 'ADMIN', 'ANALYST', 'AUDITOR', 'USER'];
    if (!role || !allowed.includes(role)) {
      next(new AppError(400, 'Invalid role'));
      return;
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role: role as never },
      select: { id: true, shortId: true, role: true },
    });
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
}

// ─── POST /super-admin/users/:id/toggle ───────────────────────────────────────

export async function toggleUserActive(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
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
    res.json({ success: true, user: updated });
  } catch (err) {
    next(err);
  }
}
