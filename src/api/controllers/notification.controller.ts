import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';

function userId(req: Request): string {
  return (req as any).user?.sub;
}

export async function getNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const unreadOnly = req.query.unread === 'true';

    const notifications = await prisma.notification.findMany({
      where: { userId: userId(req), ...(unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const unreadCount = await prisma.notification.count({
      where: { userId: userId(req), read: false },
    });

    res.json({ success: true, notifications, unreadCount });
  } catch (err) { next(err); }
}

export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await prisma.notification.updateMany({
      where: { id, userId: userId(req) },
      data: { read: true },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction) {
  try {
    await prisma.notification.updateMany({
      where: { userId: userId(req), read: false },
      data: { read: true },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function deleteNotification(req: Request, res: Response, next: NextFunction) {
  try {
    await prisma.notification.deleteMany({
      where: { id: req.params.id, userId: userId(req) },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
}
