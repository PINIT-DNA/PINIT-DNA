/**
 * Notification policy — recipients, Activity vs Notification, dedupe, isolation.
 *
 * The matrix in notification-policy.ts is the source of truth. These tests
 * exercise emitBusinessEvent and the notification subscriber against that
 * matrix; they do not invent a second set of recipient rules.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const campaignFindUnique = jest.fn<AnyAsync>();
const orgMemberFindMany = jest.fn<AnyAsync>();
const campaignMemberFindMany = jest.fn<AnyAsync>();
const versionFindUnique = jest.fn<AnyAsync>();
const incidentFindUnique = jest.fn<AnyAsync>();
const handoverFindUnique = jest.fn<AnyAsync>();
const reportFindUnique = jest.fn<AnyAsync>();

const userFindUnique = jest.fn<AnyAsync>();
const notificationFindFirst = jest.fn<AnyAsync>();
const notificationCreate = jest.fn<AnyAsync>();
const notificationUpdate = jest.fn<AnyAsync>();
const realtimeNotify = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: campaignFindUnique },
    organizationMember: { findMany: orgMemberFindMany },
    campaignMember: { findMany: campaignMemberFindMany },
    assetVersion: { findUnique: versionFindUnique },
    incident: { findUnique: incidentFindUnique },
    campaignHandover: { findUnique: handoverFindUnique },
    clientReport: { findUnique: reportFindUnique },
    user: { findUnique: userFindUnique },
    notification: {
      findFirst: notificationFindFirst,
      create: notificationCreate,
      update: notificationUpdate,
    },
  },
}));

jest.mock('../../src/services/platform-events/platform-event.engine', () => ({
  platformEvents: { emit: jest.fn() },
}));

jest.mock('../../src/services/platform-events/realtime-hub', () => ({
  realtimeHub: { notify: (...args: unknown[]) => realtimeNotify(...args) },
}));

jest.mock('../../src/services/platform-events/preference-map', () => ({
  preferenceKeyForNotificationType: () => 'notifyShareAccess',
  isPreferenceEnabled: () => true,
  USER_PREF_SELECT: { id: true },
}));

import { platformEvents } from '../../src/services/platform-events/platform-event.engine';
import {
  emitBusinessEvent,
  describeMatrix,
  EVENTS,
} from '../../src/services/platform-events/notification-policy';
import { handleNotificationSubscriber } from '../../src/services/platform-events/notification-subscriber';
import { emitMonitoringLifecycle, emitCrawlerScanCompleted } from '../../src/services/platform-events/extended-events';

const emit = platformEvents.emit as jest.Mock;

const CAMP = 'camp-1';
const ORG = 'org-1';
const AUTHOR = 'author-1';
const ASSIGNED = 'assigned-1';
const ACTOR = 'actor-1';
const RANDOM_ORG = 'org-member-unrelated';
const OTHER_ORG_USER = 'other-org-user';
const EXTERNAL = 'external-creator-1';

function stubCampaignGraph() {
  campaignFindUnique.mockResolvedValue({ organizationId: ORG });
  orgMemberFindMany.mockImplementation(async (args: unknown) => {
    const where = (args as { where?: { role?: unknown } }).where;
    if (where?.role) {
      return [{ userId: AUTHOR }, { userId: ASSIGNED }].map((r) => r);
    }
    return [
      { userId: AUTHOR },
      { userId: ASSIGNED },
      { userId: ACTOR },
      { userId: RANDOM_ORG },
    ];
  });
  campaignMemberFindMany.mockResolvedValue([
    { userId: ASSIGNED },
  ]);
  versionFindUnique.mockResolvedValue({ createdByUserId: AUTHOR });
}

describe('describeMatrix', () => {
  test('classifies Activity vs Notification/Alert exactly as declared', () => {
    const rows = describeMatrix();
    const byEvent = Object.fromEntries(rows.map((r) => [r.event, r]));

    expect(byEvent['review.change_requested']?.class).toBe('NOTIFICATION');
    expect(byEvent['review.comment_added']?.class).toBe('NOTIFICATION');
    expect(byEvent['review.version_approved']?.class).toBe('NOTIFICATION');
    expect(byEvent['finding.confirmed']?.class).toBe('NOTIFICATION');
    expect(byEvent['monitoring.discovery_confirmed']?.class).toBe('ALERT');
    expect(byEvent['investigation.evidence_added']?.class).toBe('NOTIFICATION');
    expect(byEvent['investigation.updated']?.class).toBe('NOTIFICATION');

    expect(byEvent['creator.access_granted']?.class).toBe('ACTIVITY');
    expect(byEvent['finding.dismissed']?.class).toBe('ACTIVITY');
    expect(byEvent['handover.created']?.class).toBe('ACTIVITY');
    expect(byEvent['report.generated']?.class).toBe('ACTIVITY');

    expect(EVENTS['review.change_requested']?.mustNotReceive).toMatch(/Anyone outside this campaign/);
  });

  test('every declared event names an entity type and a must-not-receive rule', () => {
    for (const row of describeMatrix()) {
      expect(row.entityType).toBeTruthy();
      expect(row.mustNotReceive).toBeTruthy();
      expect(row.action).toBeTruthy();
    }
  });
});

describe('emitBusinessEvent recipients', () => {
  beforeEach(() => {
    emit.mockReset();
    campaignFindUnique.mockReset();
    orgMemberFindMany.mockReset();
    campaignMemberFindMany.mockReset();
    versionFindUnique.mockReset();
    incidentFindUnique.mockReset();
    stubCampaignGraph();
  });

  test('client change request notifies version author + assigned campaign members, not a random org member', async () => {
    const result = await emitBusinessEvent('review.change_requested', {
      organizationId: ORG,
      campaignId: CAMP,
      assetId: 'asset-1',
      assetName: 'brief.pdf',
      versionId: 'ver-1',
      versionNumber: 2,
      actorUserId: null,
      actorLabel: 'Acme client',
      detail: 'Wrong crop',
    });

    expect(result.skipped).toBe(false);
    expect(result.recipients.sort()).toEqual([ASSIGNED, AUTHOR].sort());
    expect(result.recipients).not.toContain(RANDOM_ORG);
    expect(result.recipients).not.toContain(OTHER_ORG_USER);
    expect(result.recipients).not.toContain(EXTERNAL);

    expect(emit).toHaveBeenCalledTimes(2);
    const payloads = emit.mock.calls.map((c) => c[0] as Record<string, unknown>);
    for (const p of payloads) {
      expect(p.deepLink).toBe('/business/campaigns/camp-1?tab=approvals&asset=asset-1');
      expect(p.entityType).toBe('version');
      expect(p.entityId).toBe('ver-1');
      expect(p.payload).toEqual({ notificationClass: 'NOTIFICATION' });
      expect(String(p.dedupeKey)).toMatch(/^review\.change_requested:ver-1:/);
      expect(p.title).toContain('Acme client');
      expect(p.body).toContain('Wrong crop');
    }
  });

  test('team comment excludes the actor and people outside the org', async () => {
    const result = await emitBusinessEvent('review.comment_added', {
      organizationId: ORG,
      campaignId: CAMP,
      assetId: 'asset-1',
      actorUserId: ASSIGNED,
      actorLabel: 'Assigned reviewer',
      detail: 'Will recrop',
      targetUserIds: [OTHER_ORG_USER, AUTHOR],
    });

    expect(result.recipients).toContain(AUTHOR);
    expect(result.recipients).not.toContain(ASSIGNED);
    expect(result.recipients).not.toContain(OTHER_ORG_USER);
    expect(result.recipients).not.toContain(RANDOM_ORG);
  });

  test('version approved notifies assigned members minus the actor', async () => {
    const result = await emitBusinessEvent('review.version_approved', {
      organizationId: ORG,
      campaignId: CAMP,
      assetId: 'asset-1',
      versionId: 'ver-1',
      versionNumber: 2,
      actorUserId: ASSIGNED,
      actorLabel: 'Client',
    });

    expect(result.recipients).not.toContain(ASSIGNED);
    expect(result.recipients).toContain(AUTHOR);
    const payloads = emit.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(payloads.every((p) => p.deepLink === '/business/campaigns/camp-1?tab=approvals&asset=asset-1')).toBe(true);
  });

  test('Activity events resolve an audience but never emit a notification', async () => {
    for (const event of [
      'creator.access_granted',
      'finding.dismissed',
      'handover.created',
      'report.generated',
    ] as const) {
      emit.mockReset();
      const result = await emitBusinessEvent(event, {
        organizationId: ORG,
        campaignId: CAMP,
        actorUserId: ACTOR,
        findingId: 'find-1',
        handoverId: 'ho-1',
        reportId: 'rep-1',
      });
      expect(result.skipped).toBe(true);
      expect(result.recipients).not.toContain(ACTOR);
      expect(result.recipients).not.toContain(RANDOM_ORG);
      expect(emit).not.toHaveBeenCalled();
    }
  });

  test('investigation evidence notifies case owners only, not a random org member', async () => {
    incidentFindUnique.mockResolvedValue({
      assignedToUserId: AUTHOR,
      openedByUserId: ASSIGNED,
    });
    const result = await emitBusinessEvent('investigation.evidence_added', {
      organizationId: ORG,
      campaignId: CAMP,
      investigationId: 'inv-1',
      caseCode: 'CASE-1',
      actorUserId: ACTOR,
    });
    expect(result.skipped).toBe(false);
    expect(result.recipients.sort()).toEqual([AUTHOR, ASSIGNED].sort());
    expect(result.recipients).not.toContain(RANDOM_ORG);
    const p = emit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(p.deepLink).toBe('/business/campaigns/camp-1?tab=investigations&case=inv-1');
    expect(p.payload).toEqual({ notificationClass: 'NOTIFICATION' });
  });

  test('duplicate same event + entity + recipient reuses the same dedupe key', async () => {
    const ctx = {
      organizationId: ORG,
      campaignId: CAMP,
      assetId: 'asset-1',
      versionId: 'ver-1',
      versionNumber: 2,
      actorLabel: 'Acme client',
    };
    await emitBusinessEvent('review.change_requested', ctx);
    await emitBusinessEvent('review.change_requested', ctx);
    const keys = emit.mock.calls.map((c) => (c[0] as { dedupeKey: string }).dedupeKey);
    expect(keys).toEqual([
      `review.change_requested:ver-1:${AUTHOR}`,
      `review.change_requested:ver-1:${ASSIGNED}`,
      `review.change_requested:ver-1:${AUTHOR}`,
      `review.change_requested:ver-1:${ASSIGNED}`,
    ]);
  });

  test('refuses to emit when campaignId is missing (no generic list link)', async () => {
    const result = await emitBusinessEvent('review.comment_added', {
      organizationId: ORG,
      assetId: 'asset-1',
    });
    expect(result.skipped).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('notification subscriber', () => {
  beforeEach(() => {
    userFindUnique.mockReset();
    notificationFindFirst.mockReset();
    notificationCreate.mockReset();
    notificationUpdate.mockReset();
    realtimeNotify.mockReset();
    userFindUnique.mockResolvedValue({ id: AUTHOR });
    notificationFindFirst.mockResolvedValue(null);
    notificationCreate.mockResolvedValue({ id: 'n1' });
  });

  test('does not persist Activity-class payloads', async () => {
    await handleNotificationSubscriber({
      name: 'finding.dismissed',
      category: 'monitoring',
      severity: 'info',
      ownerUserId: AUTHOR,
      entityType: 'finding',
      entityId: 'find-1',
      title: 'Match dismissed',
      body: 'Judged unrelated.',
      payload: { notificationClass: 'ACTIVITY' },
    });
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  test('does not persist when skipNotification is set (empty scan / monitoring start)', async () => {
    await handleNotificationSubscriber({
      name: 'monitoring.started',
      category: 'monitoring',
      severity: 'info',
      ownerUserId: AUTHOR,
      entityType: 'monitor_record',
      entityId: 'mon-1',
      title: 'Monitoring started',
      body: 'started',
      skipNotification: true,
    });
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  test('persists a Notification-class row with entity + deep link, then drops duplicates', async () => {
    await handleNotificationSubscriber({
      name: 'review.change_requested',
      category: 'sharing',
      severity: 'warning',
      ownerUserId: AUTHOR,
      entityType: 'version',
      entityId: 'ver-1',
      title: 'Acme client requested changes',
      body: 'Wrong crop',
      deepLink: '/business/campaigns/camp-1?tab=approvals&asset=asset-1',
      notificationType: 'SHARE_REJECTED',
      dedupeKey: `review.change_requested:ver-1:${AUTHOR}`,
      payload: { notificationClass: 'NOTIFICATION' },
    });
    expect(notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: AUTHOR,
        entityType: 'version',
        entityId: 'ver-1',
        notificationClass: 'NOTIFICATION',
        deepLink: '/business/campaigns/camp-1?tab=approvals&asset=asset-1',
        dedupeKey: `review.change_requested:ver-1:${AUTHOR}`,
        read: false,
      }),
    });

    notificationFindFirst.mockResolvedValue({ id: 'n1' });
    notificationCreate.mockClear();
    await handleNotificationSubscriber({
      name: 'review.change_requested',
      category: 'sharing',
      severity: 'warning',
      ownerUserId: AUTHOR,
      entityType: 'version',
      entityId: 'ver-1',
      title: 'Acme client requested changes',
      body: 'Wrong crop',
      deepLink: '/business/campaigns/camp-1?tab=approvals&asset=asset-1',
      notificationType: 'SHARE_REJECTED',
      dedupeKey: `review.change_requested:ver-1:${AUTHOR}`,
      payload: { notificationClass: 'NOTIFICATION' },
    });
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});

describe('legacy monitoring emitters', () => {
  beforeEach(() => {
    emit.mockReset();
  });

  test('monitoring started/paused/resumed/stopped never create a bell notification', () => {
    emitMonitoringLifecycle({
      ownerUserId: AUTHOR,
      monitorRecordId: 'mon-1',
      filename: 'brief.pdf',
      action: 'started',
    });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      skipNotification: true,
      notificationType: 'MONITORING_STARTED',
    }));
  });

  test('a crawler scan with no matches does not notify', () => {
    emitCrawlerScanCompleted({
      ownerUserId: AUTHOR,
      monitorRecordId: 'mon-1',
      filename: 'brief.pdf',
      matchesFound: 0,
      urlsChecked: 12,
    });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      skipNotification: true,
      notificationType: 'CRAWLER_SCAN_COMPLETED',
    }));
  });

  test('a crawler scan with matches does not emit the empty-scan event', () => {
    emitCrawlerScanCompleted({
      ownerUserId: AUTHOR,
      monitorRecordId: 'mon-1',
      filename: 'brief.pdf',
      matchesFound: 2,
      urlsChecked: 12,
    });
    expect(emit).not.toHaveBeenCalled();
  });
});
