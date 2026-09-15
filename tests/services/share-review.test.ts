/**
 * Client review through a campaign share token.
 *
 * Authority is the token. Scope is derived server-side. Recipients must never
 * become organisation or campaign People members as a side effect of commenting.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const shareFindUnique = jest.fn<AnyAsync>();
const assetFindUnique = jest.fn<AnyAsync>();
const versionFindFirst = jest.fn<AnyAsync>();
const versionFindMany = jest.fn<AnyAsync>();
const versionFindUnique = jest.fn<AnyAsync>();
const versionUpdate = jest.fn<AnyAsync>();
const commentFindMany = jest.fn<AnyAsync>();
const commentFindFirst = jest.fn<AnyAsync>();
const commentCreate = jest.fn<AnyAsync>();
const orgMemberCreate = jest.fn<AnyAsync>();
const campaignMemberCreate = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    shareLink: { findUnique: shareFindUnique },
    asset: { findUnique: assetFindUnique },
    assetVersion: {
      findFirst: versionFindFirst,
      findMany: versionFindMany,
      findUnique: versionFindUnique,
      update: versionUpdate,
    },
    reviewComment: {
      findMany: commentFindMany,
      findFirst: commentFindFirst,
      create: commentCreate,
    },
    organizationMember: { create: orgMemberCreate },
    campaignMember: { create: campaignMemberCreate },
  },
}));

const emitBusinessEvent = jest.fn<AnyAsync>().mockResolvedValue({ recipients: ['reviewer-1'], skipped: false });

jest.mock('../../src/services/organization/audit-log.service', () => ({
  logOrgAudit: jest.fn<AnyAsync>().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/platform-events/notification-policy', () => ({
  emitBusinessEvent: (...args: unknown[]) => emitBusinessEvent(...args),
}));

jest.mock('../../src/services/organization/review-comment.service', () => ({
  reviewCommentService: {
    validateInput: (input: { body?: unknown }) => ({
      body: String(input.body ?? '').trim(),
      anchor: undefined,
    }),
  },
}));

import { resolveReviewContext, shareReviewService } from '../../src/services/share/share-review.service';

const LINK = {
  id: 'share-1',
  token: 'tok_abc',
  isActive: true,
  expiresAt: null as Date | null,
  reviewMode: true,
  allowComments: true,
  allowChangeRequest: true,
  allowApproval: false,
  requireOtp: false,
  otpVerified: false,
  reviewVersionId: null as string | null,
  assetId: 'asset-1',
  filename: 'brief.pdf',
  shareRecipientId: null as string | null,
  recipientLabel: 'Acme client',
};

const ASSET = {
  id: 'asset-1',
  campaignId: 'camp-1',
  campaign: { id: 'camp-1', organizationId: 'org-1' },
};

const VERSION = {
  id: 'ver-1',
  assetId: 'asset-1',
  versionNumber: 2,
  reviewStatus: 'IN_REVIEW',
  originalFilename: 'brief-v2.pdf',
  supersededAt: null,
};

function happyPathLink() {
  shareFindUnique.mockResolvedValue({ ...LINK });
  assetFindUnique.mockResolvedValue({ ...ASSET });
  versionFindFirst.mockResolvedValue({ ...VERSION });
}

describe('resolveReviewContext', () => {
  beforeEach(() => {
    shareFindUnique.mockReset();
    assetFindUnique.mockReset();
    versionFindFirst.mockReset();
    versionFindMany.mockReset();
    versionFindUnique.mockReset();
    versionUpdate.mockReset();
    commentFindMany.mockReset();
    commentFindFirst.mockReset();
    commentCreate.mockReset();
    orgMemberCreate.mockReset();
    campaignMemberCreate.mockReset();
  });

  test('404 for missing token and for view-only links (same message)', async () => {
    shareFindUnique.mockResolvedValue(null);
    await expect(resolveReviewContext('nope')).rejects.toEqual(
      expect.objectContaining({ statusCode: 404 }),
    );

    shareFindUnique.mockResolvedValue({ ...LINK, reviewMode: false });
    await expect(resolveReviewContext('tok_abc')).rejects.toEqual(
      expect.objectContaining({ statusCode: 404, message: 'Review is not available for this link' }),
    );
  });

  test('403 for revoked and expired review links', async () => {
    shareFindUnique.mockResolvedValue({ ...LINK, isActive: false });
    await expect(resolveReviewContext('tok_abc')).rejects.toEqual(
      expect.objectContaining({ statusCode: 403, message: 'Access revoked' }),
    );

    shareFindUnique.mockResolvedValue({ ...LINK, expiresAt: new Date(Date.now() - 60_000) });
    await expect(resolveReviewContext('tok_abc')).rejects.toEqual(
      expect.objectContaining({ statusCode: 403, message: 'Review link expired' }),
    );
  });

  test('follows the current non-superseded version when reviewVersionId is unset', async () => {
    happyPathLink();
    const ctx = await resolveReviewContext('tok_abc');
    expect(ctx.organizationId).toBe('org-1');
    expect(ctx.campaignId).toBe('camp-1');
    expect(ctx.assetId).toBe('asset-1');
    expect(ctx.versionId).toBe('ver-1');
    expect(ctx.versionNumber).toBe(2);
    expect(versionFindFirst).toHaveBeenCalledWith({
      where: { assetId: 'asset-1', supersededAt: null },
      orderBy: { versionNumber: 'desc' },
    });
  });

  test('pins to reviewVersionId when set, and refuses a version from another asset', async () => {
    shareFindUnique.mockResolvedValue({ ...LINK, reviewVersionId: 'ver-other' });
    assetFindUnique.mockResolvedValue({ ...ASSET });
    versionFindFirst.mockResolvedValue(null);
    await expect(resolveReviewContext('tok_abc')).rejects.toEqual(
      expect.objectContaining({ statusCode: 404 }),
    );
    expect(versionFindFirst).toHaveBeenCalledWith({
      where: { id: 'ver-other', assetId: 'asset-1' },
    });
  });
});

describe('shareReviewService.createComment', () => {
  beforeEach(() => {
    shareFindUnique.mockReset();
    assetFindUnique.mockReset();
    versionFindFirst.mockReset();
    versionFindUnique.mockReset();
    versionUpdate.mockReset();
    commentCreate.mockReset();
    orgMemberCreate.mockReset();
    campaignMemberCreate.mockReset();
    emitBusinessEvent.mockClear();
    happyPathLink();
    commentCreate.mockResolvedValue({
      id: 'c1',
      kind: 'COMMENT',
      status: 'OPEN',
      body: 'Please crop the logo',
      authorLabel: 'Acme client',
      authorRecipientId: 'share-1',
      anchor: null,
      anchorOrphaned: false,
      versionId: 'ver-1',
      parentId: null,
      createdAt: new Date('2026-09-01T05:00:00Z'),
    });
  });

  test('stores the comment on the campaign + asset + version from the token', async () => {
    const created = await shareReviewService.createComment('tok_abc', {
      body: 'Please crop the logo',
      kind: 'COMMENT',
      authorLabel: 'Jordan',
    });

    expect(commentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        campaignId: 'camp-1',
        assetId: 'asset-1',
        versionId: 'ver-1',
        kind: 'COMMENT',
        authorRecipientId: 'share-1',
        body: 'Please crop the logo',
      }),
    });
    expect(created.isClient).toBe(true);
    expect(created.authorUserId).toBeNull();
    expect(orgMemberCreate).not.toHaveBeenCalled();
    expect(campaignMemberCreate).not.toHaveBeenCalled();
    expect(emitBusinessEvent).toHaveBeenCalledWith(
      'review.comment_added',
      expect.objectContaining({
        organizationId: 'org-1',
        campaignId: 'camp-1',
        assetId: 'asset-1',
        versionId: 'ver-1',
        actorUserId: null,
        actorLabel: 'Jordan',
        assetName: 'brief-v2.pdf',
      }),
    );
  });

  test('change request on IN_REVIEW moves the version to CHANGES_REQUESTED', async () => {
    commentCreate.mockResolvedValue({
      id: 'c2',
      kind: 'CHANGE_REQUEST',
      status: 'OPEN',
      body: 'Wrong crop',
      authorLabel: 'Acme client',
      authorRecipientId: 'share-1',
      anchor: null,
      anchorOrphaned: false,
      versionId: 'ver-1',
      parentId: null,
      createdAt: new Date(),
    });
    versionFindUnique.mockResolvedValue({ reviewStatus: 'IN_REVIEW' });

    await shareReviewService.createComment('tok_abc', {
      body: 'Wrong crop',
      kind: 'CHANGE_REQUEST',
    });

    expect(versionUpdate).toHaveBeenCalledWith({
      where: { id: 'ver-1' },
      data: { reviewStatus: 'CHANGES_REQUESTED' },
    });
    expect(orgMemberCreate).not.toHaveBeenCalled();
    expect(emitBusinessEvent).toHaveBeenCalledWith(
      'review.change_requested',
      expect.objectContaining({
        campaignId: 'camp-1',
        versionId: 'ver-1',
        actorUserId: null,
      }),
    );
  });

  test('refuses comments when the link has comments turned off', async () => {
    shareFindUnique.mockResolvedValue({ ...LINK, allowComments: false });
    await expect(shareReviewService.createComment('tok_abc', { body: 'hi' })).rejects.toEqual(
      expect.objectContaining({ statusCode: 403 }),
    );
    expect(commentCreate).not.toHaveBeenCalled();
  });
});

describe('shareReviewService.getContext', () => {
  beforeEach(() => {
    shareFindUnique.mockReset();
    assetFindUnique.mockReset();
    versionFindFirst.mockReset();
    versionFindMany.mockReset();
    happyPathLink();
    versionFindMany.mockResolvedValue([
      { ...VERSION, createdAt: new Date(), changeSummary: 'V2', supersededAt: null },
      {
        id: 'ver-0', versionNumber: 1, reviewStatus: 'SUPERSEDED', createdAt: new Date(),
        originalFilename: 'brief.pdf', supersededAt: new Date(), changeSummary: 'V1',
      },
    ]);
  });

  test('exposes version history for the linked asset only, marking the live version current', async () => {
    const ctx = await shareReviewService.getContext('tok_abc');
    expect(ctx.versionId).toBe('ver-1');
    expect(ctx.reviewStatus).toBe('IN_REVIEW');
    expect(ctx.versions).toHaveLength(2);
    expect(ctx.versions[0]?.isCurrent).toBe(true);
    expect(ctx.versions[1]?.superseded).toBe(true);
    expect(versionFindMany).toHaveBeenCalledWith({
      where: { assetId: 'asset-1' },
      orderBy: { versionNumber: 'desc' },
      select: expect.any(Object),
    });
  });
});
