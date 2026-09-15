/**
 * Notification subscriber — writes to notifications table with preference checks + smart aggregation.
 */

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { PlatformEventInput } from './types';
import { realtimeHub } from './realtime-hub';
import {
  preferenceKeyForNotificationType,
  isPreferenceEnabled,
  USER_PREF_SELECT,
} from './preference-map';

const AGGREGATE_WINDOW_MS = 60 * 60 * 1000;

function severityForNotification(severity: PlatformEventInput['severity']): string {
  if (severity === 'medium') return 'warning';
  if (severity === 'success') return 'info';
  return severity;
}

/**
 * Which of the three classes this row is.
 *
 * The policy puts it in the payload. Anything emitted outside the policy has no
 * opinion and stays null — read as NOTIFICATION downstream, preserving the
 * behaviour every pre-existing emitter already had.
 */
function classOf(event: PlatformEventInput): string | null {
  const c = (event.payload as { notificationClass?: unknown } | undefined)?.notificationClass;
  return typeof c === 'string' ? c : null;
}

export async function handleNotificationSubscriber(event: PlatformEventInput): Promise<void> {
  if (event.skipNotification || !event.ownerUserId) return;
  if (classOf(event) === 'ACTIVITY') return;

  const notifType = event.notificationType ?? event.name.replace(/\./g, '_').toUpperCase();

  try {
    const user = await prisma.user.findUnique({
      where: { id: event.ownerUserId },
      select: USER_PREF_SELECT,
    });
    if (!user) return;

    const pref = preferenceKeyForNotificationType(notifType);
    if (!isPreferenceEnabled(user as Record<string, boolean>, pref)) return;

    const since = new Date(Date.now() - AGGREGATE_WINDOW_MS);

    if (event.dedupeKey && !event.aggregate) {
      const dup = await prisma.notification.findFirst({
        where: { userId: event.ownerUserId, dedupeKey: event.dedupeKey },
        select: { id: true },
      });
      if (dup) return;
    }

    if (event.aggregate && event.dedupeKey) {
      const existing = await prisma.notification.findFirst({
        where: {
          userId: event.ownerUserId,
          dedupeKey: event.dedupeKey,
          read: false,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        const count = (existing.aggregateCount ?? 1) + 1;
        const fileLabel = event.fileName ?? 'your file';
        await prisma.notification.update({
          where: { id: existing.id },
          data: {
            aggregateCount: count,
            title: `${count} new viewers opened ${fileLabel} today`,
            body: `Latest: ${event.country ?? 'Unknown'} · ${event.device ?? 'Unknown'} · ${event.body}`,
            createdAt: new Date(),
          },
        });
        await realtimeHub.notify(event.ownerUserId);
        return;
      }
    }

    await prisma.notification.create({
      data: {
        userId: event.ownerUserId,
        type: notifType,
        title: event.title,
        body: event.body,
        severity: severityForNotification(event.severity),
        category: event.category,
        read: false,
        linkToken: event.linkToken,
        fileName: event.fileName,
        ip: event.ip,
        country: event.country,
        device: event.device,
        riskLevel: event.riskLevel,
        deepLink: event.deepLink,
        dedupeKey: event.dedupeKey,
        aggregateCount: 1,
        // Set by notification-policy.ts, never by a call site. Events that
        // predate the policy leave it null and are read as NOTIFICATION,
        // which is how they already behaved.
        notificationClass: classOf(event),
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
      },
    });

    await realtimeHub.notify(event.ownerUserId);
  } catch (err) {
    logger.warn('[NotificationSubscriber] Failed', { name: event.name, error: String(err) });
  }
}
