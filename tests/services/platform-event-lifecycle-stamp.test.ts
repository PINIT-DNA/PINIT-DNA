/**
 * Unified Event Engine — lifecycle stamping must never cost an event.
 *
 * The engine now records a lifecycle type and the owning Asset.id alongside each
 * event. Those columns arrive with scripts/ensure-lifecycle-tracking.cjs, so a
 * database that has not run it yet (a developer pointed at an older database, the
 * gap between a deploy and the boot script) must still record events.
 *
 * The retry has to be raw SQL: the generated Prisma client returns every column of
 * the model after an insert, so even a create() that sets none of the new fields
 * still names them and fails the same way. That is a real failure this test pins
 * down — the first attempt at this fallback used create() and lost the event.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const platformEventCreate = jest.fn<AnyAsync>();
const platformEventFindFirst = jest.fn<AnyAsync>();
const executeRawUnsafe = jest.fn<AnyAsync>();
const assetFindFirst = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    platformEvent: { create: platformEventCreate, findFirst: platformEventFindFirst },
    asset: { findFirst: assetFindFirst },
    certificate: { findFirst: jest.fn() },
    shareLink: { findFirst: jest.fn() },
    $executeRawUnsafe: executeRawUnsafe,
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/platform-events/notification-subscriber', () => ({
  handleNotificationSubscriber: jest.fn(async () => undefined),
}));
jest.mock('../../src/services/platform-events/timeline-subscriber', () => ({
  handleTimelineSubscriber: jest.fn(async () => undefined),
}));
jest.mock('../../src/services/platform-events/audit-subscriber', () => ({
  handleAuditSubscriber: jest.fn(async () => undefined),
}));

import { platformEventsEmit } from '../../src/services/platform-events/platform-event.engine';
import { clearAssetResolutionCache } from '../../src/services/lifecycle/asset-resolver';

const OWNER = 'owner-user';

const shareEvent = {
  name: 'share.link.created',
  category: 'sharing' as const,
  severity: 'info' as const,
  ownerUserId: OWNER,
  entityType: 'share_link',
  entityId: 'link-1',
  title: 'Share link created',
  body: 'clip.mp4',
  vaultId: 'vault-1',
};

/** The engine emits on setImmediate, so let the microtask queue drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  clearAssetResolutionCache();
  platformEventCreate.mockReset().mockResolvedValue({ id: 'evt-1' });
  platformEventFindFirst.mockReset().mockResolvedValue(null);
  executeRawUnsafe.mockReset().mockResolvedValue(1);
  assetFindFirst.mockReset().mockResolvedValue({ id: 'asset-1' });
});

describe('lifecycle stamping', () => {
  test('an existing event gains its lifecycle type and owning asset', async () => {
    platformEventsEmit(shareEvent);
    await settle();

    const data = (platformEventCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.lifecycleType).toBe('SHARE_LINK_CREATED');
    expect(data.assetId).toBe('asset-1');
    expect(data.name).toBe('share.link.created');
  });

  test('an event with no lifecycle meaning is written exactly as before', async () => {
    platformEventsEmit({ ...shareEvent, name: 'monitoring.scan.completed', category: 'monitoring' });
    await settle();

    const data = (platformEventCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.lifecycleType).toBeNull();
    // No asset lookup is run for events that are not part of a lifecycle.
    expect(assetFindFirst).not.toHaveBeenCalled();
  });

  test('the event is still recorded when the lifecycle columns do not exist yet', async () => {
    platformEventCreate.mockRejectedValue(
      new Error('The column `platform_events.lifecycleType` does not exist in the current database.'),
    );

    platformEventsEmit(shareEvent);
    await settle();

    expect(executeRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = String(executeRawUnsafe.mock.calls[0]![0]);
    expect(sql).toContain('INSERT INTO "platform_events"');
    // The retry must not name the columns that are missing, in the insert or anywhere.
    expect(sql).not.toContain('lifecycleType');
    expect(sql).not.toContain('assetId');
    // ...and it must still carry the event itself.
    expect(executeRawUnsafe.mock.calls[0]).toContain('share.link.created');
    expect(executeRawUnsafe.mock.calls[0]).toContain(OWNER);
  });

  test('a genuine database failure is not retried as a missing column', async () => {
    platformEventCreate.mockRejectedValue(new Error('connection refused'));

    platformEventsEmit(shareEvent);
    await settle();

    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });

  test('persistOnce records a repeated view only once', async () => {
    platformEventFindFirst.mockResolvedValue({ id: 'already-there' });

    platformEventsEmit({
      ...shareEvent,
      name: 'vault.previewed',
      category: 'vault',
      dedupeKey: 'lifecycle:asset_viewed:vault-1:2026-09-16',
      persistOnce: true,
    });
    await settle();

    expect(platformEventCreate).not.toHaveBeenCalled();
  });
});
