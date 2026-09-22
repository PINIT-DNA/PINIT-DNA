/**
 * Unified Event Engine — single entry point for all platform events.
 */

import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { PlatformEventInput } from './types';
import { lifecycleTypeForPlatformEvent } from '../lifecycle/lifecycle-types';
import { resolveAssetId } from '../lifecycle/asset-resolver';
import { handleNotificationSubscriber } from './notification-subscriber';
import { handleTimelineSubscriber } from './timeline-subscriber';
import { handleAuditSubscriber } from './audit-subscriber';

/** The row as it has always been written — no lifecycle columns. */
function baseEventData(event: PlatformEventInput) {
  return {
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
  };
}

let warnedAboutLifecycleColumns = false;

/**
 * Write the event with only the columns that existed before the lifecycle layer.
 *
 * This has to be raw SQL: the generated Prisma client returns every column of the
 * model after an insert, so even a create() that sets none of the new fields still
 * names them and fails on a database that has not run ensure-lifecycle-tracking yet.
 */
async function insertWithoutLifecycleColumns(event: PlatformEventInput): Promise<void> {
  const data = baseEventData(event);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "platform_events"
       ("id","name","category","severity","ownerUserId","actorUserId",
        "entityType","entityId","title","body","deepLink","dedupeKey","payload")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
    data.id,
    data.name,
    data.category,
    data.severity,
    data.ownerUserId,
    data.actorUserId,
    data.entityType,
    data.entityId,
    data.title,
    data.body,
    data.deepLink,
    data.dedupeKey,
    event.payload ? JSON.stringify(event.payload) : null,
  );
}

/** Postgres 42703 (undefined_column) for the columns this change adds. */
function isMissingLifecycleColumn(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /lifecycleType|assetId/.test(message)
    && /(does not exist|Unknown argument|42703|column)/i.test(message);
}

async function persistEvent(event: PlatformEventInput): Promise<void> {
  try {
    // Lifecycle stamping (additive): events that are part of a resource lifecycle
    // also record which lifecycle step they are and which Asset they belong to, so
    // one asset's history is answerable from one id. Events with no lifecycle
    // meaning (scan completed, account, billing) resolve to null and are unchanged.
    const lifecycleType = lifecycleTypeForPlatformEvent(event);
    const assetId = lifecycleType
      ? await resolveAssetId({
          ownerUserId: event.ownerUserId,
          assetId: event.assetId,
          vaultId: event.vaultId,
          dnaRecordId: event.dnaRecordId,
          certificateId: event.certificateId,
          shareLinkId: event.shareLinkId,
          entityType: event.entityType,
          entityId: event.entityId,
        })
      : (event.assetId ?? null);

    if (event.persistOnce && event.dedupeKey) {
      const already = await prisma.platformEvent.findFirst({
        where: { dedupeKey: event.dedupeKey },
        select: { id: true },
      });
      if (already) return;
    }

    await prisma.platformEvent.create({
      data: { ...baseEventData(event), lifecycleType, assetId },
    });
  } catch (err) {
    // The lifecycle columns arrive with scripts/ensure-lifecycle-tracking.cjs at boot.
    // Between a code deploy and that script (or on a database that has not run it),
    // writing them would fail — the event itself still matters, so record it without
    // the lifecycle stamp rather than losing it.
    if (isMissingLifecycleColumn(err)) {
      try {
        await insertWithoutLifecycleColumns(event);
        if (!warnedAboutLifecycleColumns) {
          warnedAboutLifecycleColumns = true;
          logger.warn('[PlatformEvents] Lifecycle columns missing — recording events without lifecycle stamp until ensure-lifecycle-tracking runs');
        }
        return;
      } catch (retryErr) {
        logger.warn('[PlatformEvents] Persist skipped (non-fatal)', { name: event.name, error: String(retryErr) });
        return;
      }
    }
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
