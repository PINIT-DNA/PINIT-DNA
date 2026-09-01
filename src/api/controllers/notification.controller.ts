import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { realtimeHub } from '../../services/platform-events/realtime-hub';
import { BELL_NOTIFICATION_CLASS_WHERE } from '../../services/platform-events/notification-policy';
import { notificationInboxWhere } from '../../services/platform-events/notification-inbox';
import {
  applyResolvedDeepLinks,
  persistDeepLinkRepairs,
} from '../../services/platform-events/historical-notification-link';

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
    const classWhere: Prisma.NotificationWhereInput =
      view === 'bell' ? BELL_NOTIFICATION_CLASS_WHERE
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

    const uid = userId(req);
    const inboxUser = await prisma.user.findUnique({
      where: { id: uid },
      select: { notificationInboxClearedAt: true },
    });
    const inboxWhere = notificationInboxWhere(inboxUser?.notificationInboxClearedAt);

    // Bell/inbox hides rows at or before the clear watermark. History (no
    // view=bell) still returns every stored row, including those "cleared".
    if (view === 'bell') {
      Object.assign(where, inboxWhere);
    }

    const [rawNotifications, unreadCount, total, alertCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
      }),
      // Badge = unread in the current inbox only. History unread is unchanged.
      prisma.notification.count({
        where: {
          userId: uid, read: false, archived: false,
          ...BELL_NOTIFICATION_CLASS_WHERE,
          ...inboxWhere,
        },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          userId: uid, read: false, archived: false,
          notificationClass: 'ALERT',
          ...inboxWhere,
        },
      }),
    ]);

    const { rows: notifications, repairs } = await applyResolvedDeepLinks(
      rawNotifications.map((n) => ({
        id: n.id,
        userId: n.userId,
        type: n.type,
        category: n.category,
        deepLink: n.deepLink,
        linkToken: n.linkToken,
        entityType: n.entityType,
        entityId: n.entityId,
        notificationClass: n.notificationClass,
        read: n.read,
        archived: n.archived,
      })),
      uid,
    );
    if (repairs.length > 0) {
      void persistDeepLinkRepairs(uid, repairs);
    }

    const byId = new Map(notifications.map((n) => [n.id, n]));
    const payload = rawNotifications.map((n) => {
      const resolved = byId.get(n.id);
      return {
        ...n,
        deepLink: resolved?.deepLink ?? n.deepLink,
      };
    });

    res.json({
      success: true,
      notifications: payload,
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

/** Hide the current inbox from the bell/badge. Does not delete rows. */
export async function clearInbox(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = userId(req);
    await prisma.user.update({
      where: { id: uid },
      data: { notificationInboxClearedAt: new Date() },
    });
    await realtimeHub.notify(uid);
    res.json({ success: true, unreadCount: 0 });
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
      const inboxUser = await prisma.user.findUnique({
        where: { id: uid },
        select: { notificationInboxClearedAt: true },
      });
      const unreadCount = await prisma.notification.count({
        where: {
          userId: uid, read: false, archived: false,
          ...BELL_NOTIFICATION_CLASS_WHERE,
          ...notificationInboxWhere(inboxUser?.notificationInboxClearedAt),
        },
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
