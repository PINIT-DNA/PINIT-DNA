/**
 * PINIT-DNA — Super Admin Console API: Organizations, users, profiles and global search.
 * (Split out of super-admin.controller.ts, which re-exports it; handler code is unchanged.)
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import { AppError } from '../../middleware/error.middleware';
import {} from '../../../lib/health';
import {} from '../../../services/audit/admin-audit.service';
import {} from '../../../lib/platform-owner';
import { extractPinitCode, toRootPinitId, toUserPinitId, toOrgPinitId, toExchangePinitId } from '../../../lib/pinit-identity';



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
