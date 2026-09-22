/**
 * Lifecycle layer — ownership and privacy.
 *
 * Proves:
 *  A. An asset id belonging to someone else resolves to nothing, so one account's
 *     event can never be linked to another account's asset.
 *  B. Reading a lifecycle is scoped by the JWT user in the query itself, and a
 *     non-owner is indistinguishable from a missing asset.
 *  C. The same real action recorded in two stores is shown once.
 *  D. Payloads are scrubbed before they leave the server — no IPs, emails, device
 *     fingerprints or payment references.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const assetFindFirst = jest.fn<AnyAsync>();
const certificateFindFirst = jest.fn<AnyAsync>();
const shareLinkFindFirst = jest.fn<AnyAsync>();
const platformEventFindMany = jest.fn<AnyAsync>();
const timelineFindMany = jest.fn<AnyAsync>();
const videoFrameDnaCount = jest.fn<AnyAsync>();
const dnaRecordFindUnique = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    asset: { findFirst: assetFindFirst },
    certificate: { findFirst: certificateFindFirst },
    shareLink: { findFirst: shareLinkFindFirst },
    platformEvent: { findMany: platformEventFindMany },
    assetTimelineEvent: { findMany: timelineFindMany },
    videoFrameDna: { count: videoFrameDnaCount },
    dnaRecord: { findUnique: dnaRecordFindUnique },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { resolveAssetId, clearAssetResolutionCache } from '../../src/services/lifecycle/asset-resolver';
import {
  getAssetLifecycle,
  getOwnerLifecycle,
} from '../../src/services/lifecycle/lifecycle-query.service';

const OWNER = 'owner-user';
const OTHER = 'other-user';
const ASSET = 'asset-1';

const assetRow = {
  id: ASSET,
  originalFilename: 'clip.mp4',
  assetType: 'VIDEO',
  status: 'PROTECTED',
  createdAt: new Date('2026-09-01T10:00:00Z'),
  dnaId: 'dna-1',
};

beforeEach(() => {
  clearAssetResolutionCache();
  assetFindFirst.mockReset();
  certificateFindFirst.mockReset();
  shareLinkFindFirst.mockReset();
  platformEventFindMany.mockReset().mockResolvedValue([]);
  timelineFindMany.mockReset().mockResolvedValue([]);
  videoFrameDnaCount.mockReset().mockResolvedValue(0);
  dnaRecordFindUnique.mockReset().mockResolvedValue(null);
});

describe('A. asset resolution is owner-scoped', () => {
  test('a vault id resolves to the owner own asset', async () => {
    assetFindFirst.mockResolvedValue({ id: ASSET });
    await expect(resolveAssetId({ ownerUserId: OWNER, vaultId: 'vault-1' })).resolves.toBe(ASSET);

    const where = (assetFindFirst.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where.ownerUserId).toBe(OWNER);
  });

  test('another account vault id resolves to nothing', async () => {
    assetFindFirst.mockResolvedValue(null);
    await expect(resolveAssetId({ ownerUserId: OTHER, vaultId: 'vault-1' })).resolves.toBeNull();
  });

  test('a certificate pointing at someone else asset is not linked', async () => {
    certificateFindFirst.mockResolvedValue({ assetId: ASSET, ownerUserId: OTHER });
    assetFindFirst.mockResolvedValue(null);

    await expect(resolveAssetId({ ownerUserId: OWNER, certificateId: 'PINIT-CERT-1' })).resolves.toBeNull();
  });

  test('a share link is followed to its asset, still owner-checked', async () => {
    shareLinkFindFirst.mockResolvedValue({ assetId: ASSET, vaultId: 'vault-1', ownerUserId: OWNER });
    assetFindFirst.mockResolvedValue({ id: ASSET });

    await expect(resolveAssetId({ ownerUserId: OWNER, shareLinkId: 'link-1' })).resolves.toBe(ASSET);
  });

  test('with nothing to follow it does not query at all', async () => {
    await expect(resolveAssetId({ ownerUserId: OWNER })).resolves.toBeNull();
    expect(assetFindFirst).not.toHaveBeenCalled();
  });
});

describe('B. reading a lifecycle requires ownership', () => {
  test('a non-owner gets null, exactly like a missing asset', async () => {
    assetFindFirst.mockResolvedValue(null);

    await expect(getAssetLifecycle(ASSET, OTHER)).resolves.toBeNull();

    const where = (assetFindFirst.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toEqual({ id: ASSET, ownerUserId: OTHER });
  });

  test('events are queried for this owner and this asset only', async () => {
    assetFindFirst.mockResolvedValue(assetRow);

    await getAssetLifecycle(ASSET, OWNER);

    const eventWhere = (platformEventFindMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(eventWhere.ownerUserId).toBe(OWNER);
    expect(eventWhere.assetId).toBe(ASSET);

    const timelineWhere = (timelineFindMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(timelineWhere.assetId).toBe(ASSET);
  });

  test('the account-wide view is filtered by the caller', async () => {
    await getOwnerLifecycle(OWNER);
    const where = (platformEventFindMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where.ownerUserId).toBe(OWNER);
  });

  test('an empty user id reads nothing', async () => {
    await expect(getOwnerLifecycle('')).resolves.toEqual([]);
    expect(platformEventFindMany).not.toHaveBeenCalled();
  });
});

describe('C. one action is shown once', () => {
  test('the same share view from both stores collapses into a single event', async () => {
    assetFindFirst.mockResolvedValue(assetRow);
    const at = new Date('2026-09-15T10:00:00Z');

    platformEventFindMany.mockResolvedValue([
      { id: 'pe-1', createdAt: at, lifecycleType: 'SHARE_LINK_OPENED', title: 'Link viewed', body: 'from IN', payload: null },
    ]);
    timelineFindMany.mockResolvedValue([
      // Same real action, written by the share service seconds apart.
      { id: 'tl-1', createdAt: new Date(at.getTime() + 3000), eventType: 'SHARE_VIEWED', title: 'Link viewed', detail: null, payload: null },
      { id: 'tl-2', createdAt: new Date('2026-09-14T10:00:00Z'), eventType: 'LISTED', title: 'Listed', detail: null, payload: null },
    ]);

    const report = await getAssetLifecycle(ASSET, OWNER);

    const opened = report!.events.filter((e) => e.type === 'SHARE_LINK_OPENED');
    expect(opened).toHaveLength(1);
    expect(report!.events.map((e) => e.type)).toContain('ASSET_LISTED');
  });

  test('stage counts follow the events that survived', async () => {
    assetFindFirst.mockResolvedValue(assetRow);
    platformEventFindMany.mockResolvedValue([
      { id: 'pe-1', createdAt: new Date('2026-09-15T10:00:00Z'), lifecycleType: 'ASSET_PROTECTED', title: 'Protected', body: 'clip.mp4', payload: null },
      { id: 'pe-2', createdAt: new Date('2026-09-15T11:00:00Z'), lifecycleType: 'MONITORING_MATCH_FOUND', title: 'Match', body: 'found', payload: null },
    ]);

    const report = await getAssetLifecycle(ASSET, OWNER);

    expect(report!.countsByStage.protect).toBe(1);
    expect(report!.countsByStage.monitor).toBe(1);
    expect(report!.countsByStage.prove).toBe(0);
    expect(report!.events[0]!.label).toBeTruthy();
  });

  test('rows whose type is not a lifecycle type are ignored', async () => {
    assetFindFirst.mockResolvedValue(assetRow);
    platformEventFindMany.mockResolvedValue([
      { id: 'pe-x', createdAt: new Date(), lifecycleType: 'NOT_A_TYPE', title: 'x', body: 'y', payload: null },
    ]);
    timelineFindMany.mockResolvedValue([
      { id: 'tl-x', createdAt: new Date(), eventType: 'NOTE', title: 'note', detail: null, payload: null },
    ]);

    const report = await getAssetLifecycle(ASSET, OWNER);
    expect(report!.events).toEqual([]);
  });
});

describe('D. nothing sensitive leaves in a payload', () => {
  test('identifiers, locations and payment references are stripped', async () => {
    assetFindFirst.mockResolvedValue(assetRow);
    platformEventFindMany.mockResolvedValue([
      {
        id: 'pe-1',
        createdAt: new Date(),
        lifecycleType: 'SHARE_LINK_DOWNLOADED',
        title: 'Downloaded',
        body: 'clip.mp4',
        payload: {
          reason: 'allowed',
          ip: '203.0.113.9',
          buyer_email: 'someone@example.com',
          device_fingerprint: 'abc123',
          latitude: 12.97,
          razorpay_payment_id: 'pay_123',
        },
      },
    ]);

    const report = await getAssetLifecycle(ASSET, OWNER);
    const payload = report!.events[0]!.payload!;

    expect(payload.reason).toBe('allowed');
    for (const forbidden of ['ip', 'buyer_email', 'device_fingerprint', 'latitude', 'razorpay_payment_id']) {
      expect(payload[forbidden]).toBeUndefined();
    }
  });

  test('a video reports its frame DNA summary as forensic detail, not as events', async () => {
    assetFindFirst.mockResolvedValue(assetRow);
    videoFrameDnaCount.mockResolvedValue(4919);
    dnaRecordFindUnique.mockResolvedValue({
      universalFingerprints: {
        videoFrameDna: {
          everyFrame: true,
          frameMerkleRoot: 'f'.repeat(64),
          decoder: 'ffmpeg n6.0 rgb24 noautorotate',
          width: 2520,
          height: 1080,
          fps: 30,
          patchesPerFrame: 2465,
        },
      },
    });

    const report = await getAssetLifecycle(ASSET, OWNER);

    expect(report!.frameDna).toEqual(expect.objectContaining({
      framesProtected: 4919,
      everyFrame: true,
      frameMerkleRoot: 'f'.repeat(64),
      patchesPerFrame: 2465,
    }));
    // 4,919 protected frames must not become 4,919 events.
    expect(report!.events).toEqual([]);
  });
});
