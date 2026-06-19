import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import bcrypt from 'bcryptjs';

function userId(req: Request): string {
  return (req as any).user?.sub;
}

export async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId(req) },
      select: {
        id: true, shortId: true, email: true, fullName: true, role: true,
        createdAt: true, lastLoginAt: true,
        phone: true, organization: true, jobTitle: true, country: true,
        avatarUrl: true, bio: true, theme: true,
        notifyShareAccess: true, notifyRiskAlerts: true, notifyCertificates: true,
        notifyMonitoring: true, notifyUpdates: true,
      },
    });
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }

    // Profile completion percentage
    const fields = [user.fullName !== 'PINIT User', user.email, user.phone, user.organization, user.jobTitle, user.country, user.avatarUrl];
    const filled = fields.filter(Boolean).length;
    const completion = Math.round((filled / fields.length) * 100);

    res.json({ success: true, profile: { ...user, profileCompletion: completion } });
  } catch (err) { next(err); }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { fullName, phone, organization, jobTitle, country, bio, theme } = req.body;
    const user = await prisma.user.update({
      where: { id: userId(req) },
      data: {
        ...(fullName !== undefined && { fullName }),
        ...(phone !== undefined && { phone }),
        ...(organization !== undefined && { organization }),
        ...(jobTitle !== undefined && { jobTitle }),
        ...(country !== undefined && { country }),
        ...(bio !== undefined && { bio }),
        ...(theme !== undefined && { theme }),
      },
      select: {
        id: true, shortId: true, email: true, fullName: true,
        phone: true, organization: true, jobTitle: true, country: true,
        avatarUrl: true, bio: true, theme: true,
      },
    });
    res.json({ success: true, profile: user });
  } catch (err) { next(err); }
}

export async function updateNotificationPrefs(req: Request, res: Response, next: NextFunction) {
  try {
    const { notifyShareAccess, notifyRiskAlerts, notifyCertificates, notifyMonitoring, notifyUpdates } = req.body;
    const user = await prisma.user.update({
      where: { id: userId(req) },
      data: {
        ...(notifyShareAccess !== undefined && { notifyShareAccess }),
        ...(notifyRiskAlerts !== undefined && { notifyRiskAlerts }),
        ...(notifyCertificates !== undefined && { notifyCertificates }),
        ...(notifyMonitoring !== undefined && { notifyMonitoring }),
        ...(notifyUpdates !== undefined && { notifyUpdates }),
      },
    });
    res.json({
      success: true,
      notifications: {
        notifyShareAccess: user.notifyShareAccess,
        notifyRiskAlerts: user.notifyRiskAlerts,
        notifyCertificates: user.notifyCertificates,
        notifyMonitoring: user.notifyMonitoring,
        notifyUpdates: user.notifyUpdates,
      },
    });
  } catch (err) { next(err); }
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: userId(req) } });
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }

    if (user.passwordHash && currentPassword) {
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) { res.status(401).json({ success: false, error: 'Current password is incorrect' }); return; }
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: userId(req) }, data: { passwordHash: hash } });
    res.json({ success: true, message: 'Password updated' });
  } catch (err) { next(err); }
}

export async function getProfileStats(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = userId(req);
    const [dnaCount, vaultCount, shareCount, certCount, accessCount, monitorCount] = await Promise.all([
      prisma.dnaRecord.count({ where: { ownerUserId: uid } }),
      prisma.vaultRecord.count({ where: { dnaRecord: { ownerUserId: uid } } }),
      prisma.shareLink.count({ where: { ownerUserId: uid } }),
      prisma.certificate.count({ where: { ownerUserId: uid } }),
      prisma.shareAccessLog.count({ where: { shareLink: { ownerUserId: uid } } }),
      prisma.monitorRecord.count({ where: { ownerUserId: uid } }),
    ]);

    // Security score (0-100)
    const user = await prisma.user.findUnique({ where: { id: uid }, select: { passwordHash: true, email: true } });
    let securityScore = 30; // base
    if (user?.passwordHash) securityScore += 30;
    if (user?.email) securityScore += 20;
    if (dnaCount > 0) securityScore += 10;
    if (vaultCount > 0) securityScore += 10;

    res.json({
      success: true,
      stats: {
        dnaGenerated: dnaCount,
        filesProtected: vaultCount,
        activeShares: shareCount,
        accessEvents: accessCount,
        monitoringJobs: monitorCount,
        certificates: certCount,
        securityScore: Math.min(100, securityScore),
      },
    });
  } catch (err) { next(err); }
}

export async function getActivityTimeline(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = userId(req);
    const limit = Math.min(Number(req.query.limit) || 30, 100);

    // Gather recent events from multiple tables
    const [dnaRecords, vaultRecords, shareLinks, certs, accessLogs] = await Promise.all([
      prisma.dnaRecord.findMany({
        where: { ownerUserId: uid }, orderBy: { createdAt: 'desc' }, take: limit,
        select: { id: true, createdAt: true, imageFilename: true, status: true },
      }),
      prisma.vaultRecord.findMany({
        where: { dnaRecord: { ownerUserId: uid } }, orderBy: { createdAt: 'desc' }, take: limit,
        select: { id: true, createdAt: true, originalFileName: true },
      }),
      prisma.shareLink.findMany({
        where: { ownerUserId: uid }, orderBy: { createdAt: 'desc' }, take: limit,
        select: { id: true, createdAt: true, filename: true, token: true },
      }),
      prisma.certificate.findMany({
        where: { ownerUserId: uid }, orderBy: { createdAt: 'desc' }, take: limit,
        select: { id: true, createdAt: true, certificateId: true },
      }),
      prisma.shareAccessLog.findMany({
        where: { shareLink: { ownerUserId: uid }, action: { in: ['VIEWED', 'DOWNLOADED'] } },
        orderBy: { createdAt: 'desc' }, take: limit,
        select: { id: true, createdAt: true, action: true, ipAddress: true, country: true, device: true, riskLevel: true },
      }),
    ]);

    const events = [
      ...dnaRecords.map(r => ({ type: 'DNA_GENERATED', date: r.createdAt, detail: r.imageFilename, id: r.id })),
      ...vaultRecords.map(r => ({ type: 'VAULT_UPLOAD', date: r.createdAt, detail: r.originalFileName, id: r.id })),
      ...shareLinks.map(r => ({ type: 'SHARE_CREATED', date: r.createdAt, detail: r.filename, id: r.id })),
      ...certs.map(r => ({ type: 'CERT_GENERATED', date: r.createdAt, detail: r.certificateId, id: r.id })),
      ...accessLogs.map(r => ({
        type: r.riskLevel === 'HIGH' || r.riskLevel === 'CRITICAL' ? 'RISK_EVENT' : `ACCESS_${r.action}`,
        date: r.createdAt, detail: `${r.country ?? 'Unknown'} · ${r.device ?? 'Unknown'}`, id: r.id,
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);

    res.json({ success: true, events });
  } catch (err) { next(err); }
}

export async function getSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const tokens = await prisma.refreshToken.findMany({
      where: { userId: userId(req) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true },
    });
    res.json({
      success: true,
      sessions: tokens.map(t => ({
        id: t.id,
        loginAt: t.createdAt,
      })),
    });
  } catch (err) { next(err); }
}

export async function revokeSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await prisma.refreshToken.deleteMany({ where: { id, userId: userId(req) } });
    res.json({ success: true, message: 'Session revoked' });
  } catch (err) { next(err); }
}

export async function revokeAllSessions(req: Request, res: Response, next: NextFunction) {
  try {
    await prisma.refreshToken.deleteMany({ where: { userId: userId(req) } });
    res.json({ success: true, message: 'All sessions revoked' });
  } catch (err) { next(err); }
}
