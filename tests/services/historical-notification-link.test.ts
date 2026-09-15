/**
 * Historical notification destinations — rewrite generic list links only when
 * the stored entity still exists and belongs to the viewer.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const campaignFindUnique = jest.fn<AnyAsync>();
const orgMemberFindFirst = jest.fn<AnyAsync>();
const campaignMemberFindFirst = jest.fn<AnyAsync>();
const assetFindUnique = jest.fn<AnyAsync>();
const versionFindUnique = jest.fn<AnyAsync>();
const discoveryFindUnique = jest.fn<AnyAsync>();
const incidentFindUnique = jest.fn<AnyAsync>();
const handoverFindUnique = jest.fn<AnyAsync>();
const reportFindUnique = jest.fn<AnyAsync>();
const monitorFindUnique = jest.fn<AnyAsync>();
const vaultFindUnique = jest.fn<AnyAsync>();
const dnaFindUnique = jest.fn<AnyAsync>();
const certFindUnique = jest.fn<AnyAsync>();
const shareFindUnique = jest.fn<AnyAsync>();
const postFindUnique = jest.fn<AnyAsync>();
const notificationUpdateMany = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: campaignFindUnique },
    organizationMember: { findFirst: orgMemberFindFirst },
    campaignMember: { findFirst: campaignMemberFindFirst },
    asset: { findUnique: assetFindUnique },
    assetVersion: { findUnique: versionFindUnique },
    assetDiscovery: { findUnique: discoveryFindUnique },
    incident: { findUnique: incidentFindUnique },
    campaignHandover: { findUnique: handoverFindUnique },
    clientReport: { findUnique: reportFindUnique },
    monitorRecord: { findUnique: monitorFindUnique },
    vaultRecord: { findUnique: vaultFindUnique },
    dnaRecord: { findUnique: dnaFindUnique },
    certificate: { findUnique: certFindUnique },
    shareLink: { findUnique: shareFindUnique },
    protectedPost: { findUnique: postFindUnique },
    notification: { updateMany: notificationUpdateMany },
  },
}));

import {
  isGenericListDeepLink,
  resolveNotificationDestination,
  applyResolvedDeepLinks,
  persistDeepLinkRepairs,
  type HistoricalNotificationRow,
} from '../../src/services/platform-events/historical-notification-link';

const USER = 'user-1';
const CAMP = '11111111-1111-1111-1111-111111111111';
const MON = '22222222-2222-2222-2222-222222222222';
const ASSET = '33333333-3333-3333-3333-333333333333';
const CASE = '44444444-4444-4444-4444-444444444444';
const VER = '55555555-5555-5555-5555-555555555555';

function row(partial: Partial<HistoricalNotificationRow>): HistoricalNotificationRow {
  return {
    id: 'n1',
    userId: USER,
    type: 'MONITORING_MATCH',
    category: 'monitoring',
    deepLink: '/monitoring',
    linkToken: null,
    entityType: 'monitor_record',
    entityId: MON,
    notificationClass: null,
    read: false,
    archived: false,
    ...partial,
  };
}

describe('isGenericListDeepLink', () => {
  test('treats historical list pages as generic', () => {
    expect(isGenericListDeepLink('/monitoring')).toBe(true);
    expect(isGenericListDeepLink('/investigation')).toBe(true);
    expect(isGenericListDeepLink('/certificates')).toBe(true);
    expect(isGenericListDeepLink('/vault')).toBe(true);
    expect(isGenericListDeepLink('/profile?tab=notifications')).toBe(true);
    expect(isGenericListDeepLink(`/business/campaigns/${CAMP}?tab=findings`)).toBe(false);
    expect(isGenericListDeepLink('/monitoring?monitor=abc')).toBe(false);
  });
});

describe('resolveNotificationDestination', () => {
  beforeEach(() => {
    campaignFindUnique.mockReset();
    orgMemberFindFirst.mockReset();
    campaignMemberFindFirst.mockReset();
    assetFindUnique.mockReset();
    versionFindUnique.mockReset();
    discoveryFindUnique.mockReset();
    incidentFindUnique.mockReset();
    handoverFindUnique.mockReset();
    reportFindUnique.mockReset();
    monitorFindUnique.mockReset();
    vaultFindUnique.mockReset();
    dnaFindUnique.mockReset();
    certFindUnique.mockReset();
    shareFindUnique.mockReset();
    postFindUnique.mockReset();
    campaignFindUnique.mockResolvedValue({ organizationId: 'org-1' });
    orgMemberFindFirst.mockResolvedValue({ id: 'om-1' });
  });

  test('monitor with a campaign asset opens that campaign findings tab', async () => {
    monitorFindUnique.mockResolvedValue({ ownerUserId: USER, assetId: ASSET });
    assetFindUnique.mockResolvedValue({ campaignId: CAMP, ownerUserId: USER });
    const got = await resolveNotificationDestination(row({}));
    expect(got.status).toBe('resolved');
    expect(got.deepLink).toBe(`/business/campaigns/${CAMP}?tab=findings`);
  });

  test('monitor with no campaign opens the specific monitor, not the bare list', async () => {
    monitorFindUnique.mockResolvedValue({ ownerUserId: USER, assetId: null });
    const got = await resolveNotificationDestination(row({}));
    expect(got.deepLink).toBe(`/monitoring?monitor=${MON}`);
  });

  test('does not rewrite a monitor owned by someone else', async () => {
    monitorFindUnique.mockResolvedValue({ ownerUserId: 'other', assetId: ASSET });
    const got = await resolveNotificationDestination(row({}));
    expect(got.status).toBe('unresolved');
    expect(got.deepLink).toBe('/monitoring');
  });

  test('campaign investigation entity opens the case, not the forensic tool list', async () => {
    incidentFindUnique.mockResolvedValue({ campaignId: CAMP });
    const got = await resolveNotificationDestination(row({
      type: 'INVESTIGATION_STARTED',
      category: 'investigation',
      deepLink: '/investigation',
      entityType: 'investigation',
      entityId: CASE,
    }));
    expect(got.deepLink).toBe(`/business/campaigns/${CAMP}?tab=investigations&case=${CASE}`);
  });

  test('missing investigation is not invented as a campaign case', async () => {
    incidentFindUnique.mockResolvedValue(null);
    const got = await resolveNotificationDestination(row({
      deepLink: '/investigation',
      entityType: 'investigation',
      entityId: CASE,
    }));
    expect(got.deepLink).toBe('/pinit-hub/investigation');
    expect(got.reason).not.toMatch(/campaigns/);
  });

  test('version still on the campaign opens approvals with asset+version', async () => {
    versionFindUnique.mockResolvedValue({ campaignId: CAMP, assetId: ASSET });
    const got = await resolveNotificationDestination(row({
      type: 'SHARE_REJECTED',
      deepLink: '/profile?tab=notifications',
      entityType: 'version',
      entityId: VER,
    }));
    expect(got.deepLink).toContain(`/business/campaigns/${CAMP}?`);
    expect(got.deepLink).toContain('tab=approvals');
    expect(got.deepLink).toContain(`asset=${ASSET}`);
    expect(got.deepLink).toContain(`version=${VER}`);
  });

  test('keeps an already-specific campaign link when the campaign exists', async () => {
    const stored = `/business/campaigns/${CAMP}?tab=approvals&asset=${ASSET}`;
    const got = await resolveNotificationDestination(row({
      deepLink: stored,
      entityType: 'version',
      entityId: VER,
    }));
    expect(got.status).toBe('specific');
    expect(got.deepLink).toBe(stored);
    expect(versionFindUnique).not.toHaveBeenCalled();
  });

  test('does not invent a replacement when the stored campaign is gone', async () => {
    campaignFindUnique.mockResolvedValue(null);
    const stored = `/business/campaigns/${CAMP}?tab=findings`;
    const got = await resolveNotificationDestination(row({
      deepLink: stored,
      entityType: 'finding',
      entityId: 'find-1',
    }));
    expect(got.status).toBe('unresolved');
    expect(got.deepLink).toBe(stored);
    expect(got.reason).toBe('stored-campaign-missing');
  });

  test('share token becomes the intelligence page for that link', async () => {
    shareFindUnique.mockResolvedValue({ ownerUserId: USER, token: 'tok_abc' });
    const got = await resolveNotificationDestination(row({
      type: 'LINK_VIEWED',
      deepLink: '/access-intelligence',
      entityType: null,
      entityId: null,
      linkToken: 'tok_abc',
    }));
    expect(got.deepLink).toBe('/access-intelligence/tok_abc');
  });

  test('Activity class is not consulted and not rewritten into a notification', async () => {
    vaultFindUnique.mockResolvedValue({ dnaRecord: { ownerUserId: USER } });
    const got = await resolveNotificationDestination(row({
      notificationClass: 'ACTIVITY',
      type: 'VAULT_STORED',
      deepLink: '/vault',
      entityType: 'vault',
      entityId: 'vault-1',
    }));
    expect(got.deepLink).toBe('/vault?id=vault-1');
  });
});

describe('applyResolvedDeepLinks + persist', () => {
  beforeEach(() => {
    campaignFindUnique.mockReset();
    orgMemberFindFirst.mockReset();
    campaignMemberFindFirst.mockReset();
    monitorFindUnique.mockReset();
    assetFindUnique.mockReset();
    notificationUpdateMany.mockReset();
    campaignFindUnique.mockResolvedValue({ organizationId: 'org-1' });
    orgMemberFindFirst.mockResolvedValue({ id: 'om-1' });
    monitorFindUnique.mockResolvedValue({ ownerUserId: USER, assetId: ASSET });
    assetFindUnique.mockResolvedValue({ campaignId: CAMP, ownerUserId: USER });
    notificationUpdateMany.mockResolvedValue({ count: 1 });
  });

  test('preserves read/archived and only queues a deepLink repair', async () => {
    const unread = row({ id: 'n-unread', read: false, archived: false });
    const read = row({ id: 'n-read', read: true, archived: false, entityId: MON });
    const { rows, repairs } = await applyResolvedDeepLinks([unread, read], USER);
    expect(rows[0]?.read).toBe(false);
    expect(rows[1]?.read).toBe(true);
    expect(rows.every((r) => r.archived === false)).toBe(true);
    expect(repairs).toHaveLength(2);
    expect(repairs.every((r) => r.deepLink.includes(`/business/campaigns/${CAMP}`))).toBe(true);

    const n = await persistDeepLinkRepairs(USER, repairs);
    expect(n).toBe(2);
    expect(notificationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'n-unread', userId: USER },
      data: { deepLink: expect.any(String) },
    });
  });
});
