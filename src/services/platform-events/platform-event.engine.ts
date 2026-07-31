/**
 * Unified Event Engine — single entry point for all platform events.
 */

import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { PlatformEventInput } from './types';
import { handleNotificationSubscriber } from './notification-subscriber';
import { handleTimelineSubscriber } from './timeline-subscriber';
import { handleAuditSubscriber } from './audit-subscriber';

async function persistEvent(event: PlatformEventInput): Promise<void> {
  try {
    await prisma.platformEvent.create({
      data: {
        id: randomUUID(),
        name: event.name,
        category: event.category,
        severity: event.severity,
        ownerUserId: event.ownerUserId,
        actorUserId: event.actorUserId ?? null,
        entityType: event.entityType,
        entityId: event.entityId,
        title: event.title,
        body: event.body,
        deepLink: event.deepLink ?? null,
        dedupeKey: event.dedupeKey ?? null,
        payload: (event.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    logger.warn('[PlatformEvents] Persist skipped (non-fatal)', { name: event.name, error: String(err) });
  }
}

/**
 * Emit a platform event. Non-blocking — does not delay caller workflows.
 */
export function platformEventsEmit(event: PlatformEventInput): void {
  setImmediate(() => {
    void (async () => {
      await persistEvent(event);
      await handleNotificationSubscriber(event);
      await handleTimelineSubscriber(event);
      await handleAuditSubscriber(event);
    })().catch(err => {
      logger.warn('[PlatformEvents] Subscriber chain failed', { name: event.name, error: String(err) });
    });
  });
}

export const platformEvents = {
  emit: platformEventsEmit,
};
