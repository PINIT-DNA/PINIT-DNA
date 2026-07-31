/**
 * PINIT-DNA — Admin Portal Controller
 *
 * All endpoints require ADMIN role.
 * Provides full visibility across all users, files, vault, activity.
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { AppError } from '../middleware/error.middleware';

function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const userId = (req as any).user?.sub;
  if (!userId) return next(new AppError(401, 'Not authenticated'));
  prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    .then(user => {
      if (!user || user.role !== 'ADMIN') return next(new AppError(403, 'Admin access required'));
      next();
    })
    .catch(() => next(new AppError(500, 'Auth check failed')));
}

// GET /admin/stats — Platform overview
async function getStats(_req: Request, res: Response, next: NextFunction) {
  try {
    const [totalUsers, totalDna, totalVault, totalLinks, totalViews, totalNotifs, totalCerts, totalLogins] = await Promise.all([
      prisma.user.count(),
      prisma.dnaRecord.count(),
      prisma.vaultRecord.count(),
      prisma.shareLink.count(),
      prisma.shareAccessLog.count(),
      prisma.notification.count(),
      prisma.certificate.count(),
      prisma.loginHistory.count(),
    ]);

    const activeUsers = await prisma.user.count({ where: { isActive: true } });
    const faceUsers = await prisma.user.count({ where: { faceRegistered: true } });
    const recentLogins = await prisma.loginHistory.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });

    res.json({
      totalUsers, activeUsers, faceUsers,
      totalDna, totalVault, totalLinks, totalViews,
      totalNotifs, totalCerts, totalLogins, recentLogins,
    });
  } catch (err) { next(err); }
}

// GET /admin/users — All users with stats
async function getUsers(_req: Request, res: Response, next: NextFunction) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true, shortId: true, fullName: true, email: true,
        role: true, isActive: true, authMethod: true, faceRegistered: true,
        createdAt: true, lastLoginAt: true, organization: true, phone: true,
        _count: {
          select: {
            dnaRecords: true, shareLinks: true, certificates: true,
            notifications: true, loginHistory: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ users, total: users.length });
  } catch (err) { next(err); }
}

// GET /admin/users/:id — Single user detail
async function getUserDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params['id'] },
      select: {
        id: true, shortId: true, fullName: true, email: true,
        role: true, isActive: true, authMethod: true, faceRegistered: true,
        faceRegisteredAt: true, createdAt: true, lastLoginAt: true,
        organization: true, phone: true, country: true, jobTitle: true, bio: true,
        dnaRecords: {
          select: {
            id: true, imageFilename: true, imageMimeType: true, imageSizeBytes: true,
            fileType: true, sha256Hash: true, status: true, createdAt: true,
            vaultRecord: { select: { id: true, encryptedSizeBytes: true, originalSizeBytes: true, encryptionAlgorithm: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        shareLinks: {
          select: {
            id: true, token: true, filename: true, isActive: true,
            viewCount: true, downloadCount: true, createdAt: true, expiresAt: true,
            _count: { select: { accessLogs: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        loginHistory: {
          select: {
            id: true, method: true, ip: true, device: true, browser: true,
            os: true, city: true, country: true, success: true, failReason: true, createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        certificates: {
          select: { id: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!user) return next(new AppError(404, 'User not found'));
    res.json(user);
  } catch (err) { next(err); }
}

// GET /admin/vault — All vault files across all users
async function getAllVaultFiles(_req: Request, res: Response, next: NextFunction) {
  try {
    const files = await prisma.vaultRecord.findMany({
      select: {
        id: true, originalFileName: true, originalMimeType: true,
        originalSizeBytes: true, encryptedSizeBytes: true,
        encryptionAlgorithm: true, createdAt: true,
        dnaRecord: {
          select: {
            id: true, sha256Hash: true, fileType: true, status: true,
            ownerUserId: true,
            ownerUser: { select: { shortId: true, fullName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalSize = files.reduce((s, f) => s + f.originalSizeBytes, 0);
    const totalEncrypted = files.reduce((s, f) => s + f.encryptedSizeBytes, 0);

    res.json({ files, total: files.length, totalSize, totalEncrypted });
  } catch (err) { next(err); }
}

// GET /admin/activity — Recent activity across all users
async function getActivity(_req: Request, res: Response, next: NextFunction) {
  try {
    const [logins, accessLogs, dnaRecords] = await Promise.all([
      prisma.loginHistory.findMany({
        select: {
          id: true, method: true, ip: true, success: true, createdAt: true,
          user: { select: { shortId: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.shareAccessLog.findMany({
        select: {
          id: true, action: true, city: true, country: true,
          device: true, browser: true, createdAt: true,
          shareLink: {
            select: {
              filename: true, token: true,
              ownerUser: { select: { shortId: true, fullName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.dnaRecord.findMany({
        select: {
          id: true, imageFilename: true, fileType: true, createdAt: true,
          ownerUser: { select: { shortId: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    res.json({ logins, accessLogs, dnaRecords });
  } catch (err) { next(err); }
}

// POST /admin/users/:id/role — Change user role
async function updateUserRole(req: Request, res: Response, next: NextFunction) {
  try {
    const { role } = req.body;
    if (!['ADMIN', 'ANALYST', 'AUDITOR', 'USER'].includes(role)) {
      return next(new AppError(400, 'Invalid role'));
    }
    const user = await prisma.user.update({
      where: { id: req.params['id'] },
      data: { role },
      select: { id: true, shortId: true, role: true },
    });
    res.json({ success: true, user });
  } catch (err) { next(err); }
}

// POST /admin/users/:id/disable — Disable/enable user
async function toggleUser(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params['id'] } });
    if (!user) return next(new AppError(404, 'User not found'));
    const updated = await prisma.user.update({
      where: { id: req.params['id'] },
      data: { isActive: !user.isActive },
      select: { id: true, shortId: true, isActive: true },
    });
    res.json({ success: true, user: updated });
  } catch (err) { next(err); }
}

export { requireAdmin, getStats, getUsers, getUserDetail, getAllVaultFiles, getActivity, updateUserRole, toggleUser };
