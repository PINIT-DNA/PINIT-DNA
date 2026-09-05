import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { prisma } from '../../lib/prisma';
import bcrypt from 'bcryptjs';
import { notifyPasswordChanged, notifySessionRevoked, notifyPhoneChanged } from '../../services/platform-events/account-events';
import {
  displayAvatarUrl,
  isAvatarStorageConfigured,
  publicAvatarUrl,
  resolveAvatarSignedUrl,
  uploadAvatar as storeAvatar,
} from '../../lib/avatar-storage';
import { extractPinitCode, toExchangePinitId, toRootPinitId, toUserPinitId } from '../../lib/pinit-identity';

const AVATAR_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (AVATAR_MIMES.has(file.mimetype.toLowerCase())) cb(null, true);
    else cb(new Error('Use a JPG, PNG, WEBP, or GIF photo.'));
  },
});

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
        organizationIndustry: true, organizationSize: true, workspaceName: true,
        businessSetupCompletedAt: true, accountType: true,
        avatarUrl: true, bio: true, theme: true,
        notifyShareAccess: true, notifyRiskAlerts: true, notifyCertificates: true,
        notifyMonitoring: true, notifyUpdates: true,
        notifyVault: true, notifyDna: true, notifyInvestigation: true,
        notifyAutomation: true, notifySecurity: true, notifyReports: true, notifySystem: true,
      },
    });
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }

    // Profile completion percentage
    const fields = [user.fullName !== 'PINIT User', user.email, user.phone, user.organization, user.jobTitle, user.country, user.avatarUrl];
    const filled = fields.filter(Boolean).length;
    const completion = Math.round((filled / fields.length) * 100);

    res.json({
      success: true,
      profile: {
        ...user,
        avatarUrl: displayAvatarUrl(user.shortId, user.avatarUrl),
        profileCompletion: completion,
      },
    });
  } catch (err) { next(err); }
}

export async function uploadProfileAvatar(req: Request, res: Response, next: NextFunction) {
  try {
    if (!isAvatarStorageConfigured()) {
      res.status(503).json({ success: false, error: 'Photo storage is not configured.' });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file?.buffer?.length) {
      res.status(400).json({ success: false, error: 'Choose a photo to upload.' });
      return;
    }
    const uid = userId(req);
    const path = await storeAvatar(uid, file.buffer, file.mimetype);
    const user = await prisma.user.update({
      where: { id: uid },
      data: { avatarUrl: path },
      select: { shortId: true, avatarUrl: true, fullName: true },
    });
    res.json({
      success: true,
      profile: {
        ...user,
        avatarUrl: publicAvatarUrl(user.shortId, Date.now()),
      },
    });
  } catch (err) { next(err); }
}

export async function deleteProfileAvatar(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = userId(req);
    const user = await prisma.user.update({
      where: { id: uid },
      data: { avatarUrl: null },
      select: { shortId: true, fullName: true },
    });
    res.json({ success: true, profile: { ...user, avatarUrl: null } });
  } catch (err) { next(err); }
}

/** Public image for the portfolio site. Looks up by Pinit short id, not the internal user id. */
export async function getPublicAvatar(req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const raw = String(req.params.shortId || '').trim();
    if (!raw) {
      res.status(404).end();
      return;
    }
    const decoded = decodeURIComponent(raw);
    const code = extractPinitCode(decoded);
    const ids = [decoded, toRootPinitId(decoded), toUserPinitId(decoded), toExchangePinitId(decoded)]
      .filter(Boolean);
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { shortId: { in: ids } },
          ...(code ? [{ shortId: { endsWith: `-${code}` } }] : []),
        ],
      },
      select: { avatarUrl: true },
    });
    const signed = await resolveAvatarSignedUrl(user?.avatarUrl);
    if (!signed) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.redirect(302, signed);
  } catch (err) { next(err); }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = userId(req);
    const { fullName, phone, organization, jobTitle, country, bio, theme } = req.body;

    // Email was previously not accepted here at all, so the profile form could
    // never save one — biometric accounts are created without an email and had
    // no way to add it afterwards.
    let email: string | null | undefined;
    if (req.body.email !== undefined) {
      const raw = String(req.body.email ?? '').trim().toLowerCase();
      if (raw === '') {
        email = null; // Clearing an email is allowed.
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) {
        res.status(400).json({ success: false, error: 'Enter a valid email address.' });
        return;
      } else {
        // User.email is unique. Check before writing so a collision returns a
        // clear message rather than a raw constraint error.
        const taken = await prisma.user.findFirst({
          where: { email: raw, NOT: { id: uid } },
          select: { id: true },
        });
        if (taken) {
          res.status(409).json({
            success: false,
            error: 'That email is already used by another PINIT account.',
          });
          return;
        }
        email = raw;
      }
    }

    const prev = phone !== undefined
      ? await prisma.user.findUnique({ where: { id: uid }, select: { phone: true } })
      : null;
    const user = await prisma.user.update({
      where: { id: uid },
      data: {
        ...(fullName !== undefined && { fullName }),
        ...(email !== undefined && { email }),
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
    if (phone !== undefined && prev && prev.phone !== phone) {
      notifyPhoneChanged(uid);
    }
    res.json({ success: true, profile: user });
  } catch (err) { next(err); }
}

export async function updateNotificationPrefs(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      notifyShareAccess, notifyRiskAlerts, notifyCertificates, notifyMonitoring, notifyUpdates,
      notifyVault, notifyDna, notifyInvestigation, notifyAutomation, notifySecurity, notifyReports, notifySystem,
    } = req.body;
    const user = await prisma.user.update({
      where: { id: userId(req) },
      data: {
        ...(notifyShareAccess !== undefined && { notifyShareAccess }),
        ...(notifyRiskAlerts !== undefined && { notifyRiskAlerts }),
        ...(notifyCertificates !== undefined && { notifyCertificates }),
        ...(notifyMonitoring !== undefined && { notifyMonitoring }),
        ...(notifyUpdates !== undefined && { notifyUpdates }),
        ...(notifyVault !== undefined && { notifyVault }),
        ...(notifyDna !== undefined && { notifyDna }),
        ...(notifyInvestigation !== undefined && { notifyInvestigation }),
        ...(notifyAutomation !== undefined && { notifyAutomation }),
        ...(notifySecurity !== undefined && { notifySecurity }),
        ...(notifyReports !== undefined && { notifyReports }),
        ...(notifySystem !== undefined && { notifySystem }),
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
        notifyVault: user.notifyVault,
        notifyDna: user.notifyDna,
        notifyInvestigation: user.notifyInvestigation,
        notifyAutomation: user.notifyAutomation,
        notifySecurity: user.notifySecurity,
        notifyReports: user.notifyReports,
        notifySystem: user.notifySystem,
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
    notifyPasswordChanged(userId(req));
    res.json({ success: true, message: 'Password updated' });
  } catch (err) { next(err); }
}

export async function getProfileStats(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = userId(req);
    const [dnaCount, vaultCount, shareCount, certCount, monitorCount, accessCount] = await Promise.all([
      prisma.dnaRecord.count({ where: { ownerUserId: uid } }),
      prisma.vaultRecord.count({ where: { dnaRecord: { ownerUserId: uid } } }),
      prisma.shareLink.count({ where: { ownerUserId: uid } }),
      prisma.certificate.count({ where: { ownerUserId: uid } }),
      prisma.monitorRecord.count({ where: { ownerUserId: uid } }),
      // Access log count can be slow on large tenants — cap wait so profile stats never hang the UI
      Promise.race([
        prisma.shareAccessLog.count({ where: { shareLink: { ownerUserId: uid } } }),
        new Promise<number>((resolve) => setTimeout(() => resolve(0), 4_000)),
      ]),
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
    const uid = userId(req);
    await prisma.refreshToken.deleteMany({ where: { id, userId: uid } });
    notifySessionRevoked(uid);
    res.json({ success: true, message: 'Session revoked' });
  } catch (err) { next(err); }
}

export async function revokeAllSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = userId(req);
    const result = await prisma.refreshToken.deleteMany({ where: { userId: uid } });
    if (result.count > 0) notifySessionRevoked(uid, true);
    res.json({ success: true, message: 'All sessions revoked' });
  } catch (err) { next(err); }
}
