/**
 * O3 — a deactivated PARENT share link must report itself as inactive.
 *
 * PARENT links stay open after `oneTimeUse` is consumed so new devices can mint
 * forwarding hops. That carve-out used to apply to ANY inactive parent, so a
 * parent revoked by the owner — or deactivated because its vault was deleted —
 * still reported `isActive: true, inactiveReason: null`, and the viewer showed
 * "Verified Pinit asset" with a working "Share further" button on a dead link.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    shareLink: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    shareViewerBlock: { findFirst: jest.fn(async () => null) },
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../../src/lib/prisma';
import { shareLinkService } from '../../src/services/share/share-link.service';

const findFirst = prisma.shareLink.findFirst as unknown as jest.Mock<AnyAsync>;
const findUnique = prisma.shareLink.findUnique as unknown as jest.Mock<AnyAsync>;

const BASE = {
  id: 'link-1',
  token: 'k4DW3L-1UA',
  filename: 'Ganesha.png',
  mimeType: 'image/png',
  note: null,
  requireName: false,
  allowDownload: false,
  allowPrint: false,
  expiresAt: new Date(Date.now() + 7 * 864e5),
  maxViews: null,
  viewCount: 2,
  isActive: false,
  oneTimeUse: false,
  linkType: 'PARENT',
  tokenSignature: null,
  maxDownloads: null,
  downloadCount: 0,
  requireOtp: false,
  otpVerifiedAt: null,
  privacyMaskingEnabled: false,
  requestLocation: true,
  sourceContext: 'hub',
  licenseTier: null,
};

/** getPublicInfo resolves the row through whichever finder the service uses. */
function serve(row: Record<string, unknown> | null) {
  findFirst.mockResolvedValue(row);
  findUnique.mockResolvedValue(row);
}

beforeEach(() => {
  findFirst.mockReset();
  findUnique.mockReset();
});

describe('share link — revoked PARENT', () => {
  test('a revoked PARENT reports inactive with reason "revoked"', async () => {
    serve({ ...BASE });

    const info = await shareLinkService.getPublicInfo('k4DW3L-1UA');

    expect(info?.isActive).toBe(false);
    expect(info?.inactiveReason).toBe('revoked');
  });

  test('a PARENT consumed by oneTimeUse still accepts forwards', async () => {
    // This is the case the carve-out exists for and must keep working.
    serve({ ...BASE, oneTimeUse: true });

    const info = await shareLinkService.getPublicInfo('k4DW3L-1UA');

    expect(info?.isActive).toBe(true);
    expect(info?.inactiveReason).toBe('one_time');
  });

  test('an active PARENT is unaffected', async () => {
    serve({ ...BASE, isActive: true });

    const info = await shareLinkService.getPublicInfo('k4DW3L-1UA');

    expect(info?.isActive).toBe(true);
    expect(info?.inactiveReason).toBeNull();
  });

  test('a revoked CHILD hop still reports revoked, as before', async () => {
    serve({ ...BASE, linkType: 'CHILD' });

    const info = await shareLinkService.getPublicInfo('k4DW3L-1UA');

    expect(info?.isActive).toBe(false);
    expect(info?.inactiveReason).toBe('revoked');
  });

  test('expiry still wins over the parent carve-out', async () => {
    serve({ ...BASE, oneTimeUse: true, expiresAt: new Date(Date.now() - 1000) });

    const info = await shareLinkService.getPublicInfo('k4DW3L-1UA');

    expect(info?.isActive).toBe(false);
    expect(info?.inactiveReason).toBe('expired');
  });
});
