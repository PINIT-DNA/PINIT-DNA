import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { realtimeHub } from '../../services/platform-events/realtime-hub';

function userId(req: Request): string {
  return (req as any).user?.sub;
}

export async function getNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const unreadOnly = req.query.unread === 'true';
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const sort = req.query.sort === 'severity' ? 'severity' : 'createdAt';
    const includeArchived = req.query.includeArchived === 'true';

    /**
     * Which class of row the caller wants.
     *
     *   bell     NOTIFICATION + ALERT — things a person must know or act on
     *   activity ACTIVITY — the timeline; never badged
     *   alerts   ALERT only
     *   (unset)  everything, for the full notification page
     *
     * Rows written before the class existed are null, and are treated as
     * NOTIFICATION so nothing that used to appear silently disappears.
     */
    const view = typeof req.query.view === 'string' ? req.query.view : undefined;
    const NOTIFICATION_LIKE = { OR: [
      { notificationClass: { in: ['NOTIFICATION', 'ALERT'] } },
      { notificationClass: null },
    ] };
    const classWhere: Prisma.NotificationWhereInput =
      view === 'bell' ? NOTIFICATION_LIKE
      : view === 'activity' ? { notificationClass: 'ACTIVITY' }
      : view === 'alerts' ? { notificationClass: 'ALERT' }
      : {};

    const where: Prisma.NotificationWhereInput = {
      userId: userId(req),
      ...classWhere,
      ...(unreadOnly ? { read: false } : {}),
      ...(category ? { category } : {}),
      ...(type ? { type } : {}),
      ...(!includeArchived ? { archived: false } : {}),
      ...(search ? {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { body: { contains: search, mode: 'insensitive' } },
          { type: { contains: search, mode: 'insensitive' } },
          { fileName: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const orderBy: Prisma.NotificationOrderByWithRelationInput[] = sort === 'severity'
      ? [{ severity: 'desc' }, { createdAt: 'desc' }]
      : [{ createdAt: 'desc' }];

    const [notifications, unreadCount, total, alertCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
      }),
      // The badge counts bell-worthy rows only. Activity must never raise it.
      prisma.notification.count({
        where: {
          userId: userId(req), read: false, archived: false,
          ...NOTIFICATION_LIKE,
        },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          userId: userId(req), read: false, archived: false,
          notificationClass: 'ALERT',
        },
      }),
    ]);

    res.json({
      success: true,
      notifications,
      unreadCount,
      alertCount,
      total,
      hasMore: offset + notifications.length < total,
    });
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
      where: { userId: userId(req), read: false, archived: false },
      data: { read: true },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function archiveNotification(req: Request, res: Response, next: NextFunction) {
  try {
    await prisma.notification.updateMany({
      where: { id: req.params.id, userId: userId(req) },
      data: { archived: true, read: true },
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

/** SSE stream — pushes unread count when new notifications arrive */
export async function streamNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = userId(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as { flushHeaders?: () => void }).flushHeaders === 'function') {
      (res as { flushHeaders: () => void }).flushHeaders();
    }

    const push = async () => {
      const unreadCount = await prisma.notification.count({
        where: { userId: uid, read: false, archived: false },
      });
      res.write(`data: ${JSON.stringify({ unreadCount, ts: Date.now() })}\n\n`);
    };

    await push();
    const unsub = realtimeHub.subscribe(uid, push);
    const heartbeat = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  } catch (err) { next(err); }
}
