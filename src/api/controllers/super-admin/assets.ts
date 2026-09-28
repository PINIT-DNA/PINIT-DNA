/**
 * PINIT-DNA — Super Admin Console API: Vault, files, DNA, certificates, investigations, tracking, monitoring, analytics, audit.
 * (Split out of super-admin.controller.ts, which re-exports it; handler code is unchanged.)
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import { AppError } from '../../middleware/error.middleware';
import {} from '../../../lib/health';
import { adminAuditService } from '../../../services/audit/admin-audit.service';
import {} from '../../../lib/platform-owner';

const DAY_MS = 24 * 60 * 60 * 1000;


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
        ownerUser: { select: { id: true, shortId: true, fullName: true } },
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
    const { buildIntelligenceReportPayload } = await import('../../../services/intelligence/intelligence-report.builder');
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
    const { getVaultTrackingDashboard } = await import('../../../services/provenance');
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
    const { loadEvidenceTimeline, loadDownloadHistory } = await import('../../../services/provenance/timeline.service');
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
