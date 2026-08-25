/**
 * Client-side review through a secure share link.
 *
 * The client has no Pinit account. Their entire authority comes from the share
 * token, and their scope is derived server-side:
 *
 *   token -> ShareLink -> assetId -> Asset.campaignId -> Campaign.organizationId
 *
 * Nothing about scope is ever read from the request body. A client cannot name
 * a campaign, an organization or another asset — they can only act on the one
 * thing the link points at.
 *
 * Permission is per-link and defaults to off, so every share link created
 * before review mode existed stays a plain view-only link.
 */
import type { CommentKind } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { logOrgAudit } from '../organization/audit-log.service';

export interface ReviewContext {
  shareLinkId: string;
  token: string;
  organizationId: string;
  campaignId: string;
  assetId: string;
  versionId: string;
  versionNumber: number;
  reviewStatus: string;
  filename: string;
  allowComments: boolean;
  allowChangeRequest: boolean;
  recipientId: string | null;
  recipientLabel: string;
}

/**
 * Resolve what a token may review, or explain why it may not.
 *
 * Deliberately returns the same 404 for "no such link" and "link is not in
 * review mode", so a token cannot be used to probe which links exist.
 */
export async function resolveReviewContext(token: string): Promise<ReviewContext> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    select: {
      id: true, token: true, isActive: true, expiresAt: true,
      reviewMode: true, allowComments: true, allowChangeRequest: true,
      reviewVersionId: true, assetId: true, filename: true,
      shareRecipientId: true, recipientLabel: true,
    },
  });

  if (!link || !link.reviewMode) throw new AppError(404, 'Review is not available for this link');
  if (!link.isActive) throw new AppError(403, 'Access revoked');
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    throw new AppError(403, 'Review link expired');
  }
  if (!link.assetId) throw new AppError(404, 'Review is not available for this link');

  const asset = await prisma.asset.findUnique({
    where: { id: link.assetId },
    select: { id: true, campaignId: true, campaign: { select: { id: true, organizationId: true } } },
  });
  if (!asset?.campaign) throw new AppError(404, 'Review is not available for this link');

  // A pinned version wins; otherwise the current (non-superseded) one.
  const version = link.reviewVersionId
    ? await prisma.assetVersion.findFirst({ where: { id: link.reviewVersionId, assetId: asset.id } })
    : await prisma.assetVersion.findFirst({
        where: { assetId: asset.id, supersededAt: null },
        orderBy: { versionNumber: 'desc' },
      });

  if (!version) throw new AppError(404, 'This file has no version to review yet');

  return {
    shareLinkId: link.id,
    token: link.token,
    organizationId: asset.campaign.organizationId,
    campaignId: asset.campaign.id,
    assetId: asset.id,
    versionId: version.id,
    versionNumber: version.versionNumber,
    reviewStatus: version.reviewStatus,
    filename: version.originalFilename || link.filename,
    allowComments: link.allowComments,
    allowChangeRequest: link.allowChangeRequest,
    recipientId: link.shareRecipientId,
    recipientLabel: link.recipientLabel?.trim() || 'Client',
  };
}

export const shareReviewService = {
  /** What the client sees when they open a review link. */
  async getContext(token: string) {
    const ctx = await resolveReviewContext(token);
    const versions = await prisma.assetVersion.findMany({
      where: { assetId: ctx.assetId },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true, versionNumber: true, reviewStatus: true, createdAt: true,
        originalFilename: true, supersededAt: true, changeSummary: true,
      },
    });

    return {
      filename: ctx.filename,
      versionId: ctx.versionId,
      versionNumber: ctx.versionNumber,
      reviewStatus: ctx.reviewStatus,
      allowComments: ctx.allowComments,
      allowChangeRequest: ctx.allowChangeRequest,
      recipientLabel: ctx.recipientLabel,
      // History is visible but read-only — the client can see that V1 existed
      // without being able to reach into it.
      versions: versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        reviewStatus: v.reviewStatus,
        createdAt: v.createdAt.toISOString(),
        changeSummary: v.changeSummary,
        isCurrent: v.id === ctx.versionId,
        superseded: Boolean(v.supersededAt),
      })),
    };
  },

  /**
   * Threads on the version this link points at.
   *
   * The client sees the whole conversation for their version — including team
   * replies, which is the point — but never another version's threads and never
   * another campaign's.
   */
  async listComments(token: string) {
    const ctx = await resolveReviewContext(token);
    if (!ctx.allowComments) throw new AppError(403, 'Comments are turned off for this link');

    const all = await prisma.reviewComment.findMany({
      where: { versionId: ctx.versionId, organizationId: ctx.organizationId },
      orderBy: { createdAt: 'asc' },
    });

    const repliesByParent = new Map<string, typeof all>();
    for (const c of all) {
      if (!c.parentId) continue;
      const list = repliesByParent.get(c.parentId) ?? [];
      list.push(c);
      repliesByParent.set(c.parentId, list);
    }

    // Internal user ids are never exposed to a client.
    const strip = (c: (typeof all)[number]) => ({
      id: c.id,
      kind: c.kind,
      status: c.status,
      body: c.body,
      authorLabel: c.authorLabel,
      authorUserId: null,
      isClient: Boolean(c.authorRecipientId),
      anchor: c.anchor ?? null,
      anchorOrphaned: c.anchorOrphaned,
      mentionedUserIds: [] as string[],
      versionId: c.versionId,
      parentId: c.parentId,
      createdAt: c.createdAt.toISOString(),
      resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
      replies: [] as unknown[],
    });

    const roots = all.filter((c) => !c.parentId);
    const counts = roots.reduce(
      (acc, c) => {
        if (c.status === 'OPEN' || c.status === 'IN_PROGRESS') acc.open += 1;
        else acc.resolved += 1;
        if (c.kind === 'CHANGE_REQUEST' && (c.status === 'OPEN' || c.status === 'IN_PROGRESS')) {
          acc.openChangeRequests += 1;
        }
        return acc;
      },
      { open: 0, resolved: 0, openChangeRequests: 0 },
    );

    return {
      comments: roots.map((r) => ({
        ...strip(r),
        replies: (repliesByParent.get(r.id) ?? []).map(strip),
      })),
      counts,
    };
  },

  /** Post a comment or raise a change request as the client. */
  async createComment(
    token: string,
    input: { body?: unknown; kind?: string; parentId?: string | null; anchor?: unknown; authorLabel?: string },
  ) {
    const ctx = await resolveReviewContext(token);
    if (!ctx.allowComments) throw new AppError(403, 'Comments are turned off for this link');

    const wantsChangeRequest = input.kind === 'CHANGE_REQUEST';
    if (wantsChangeRequest && !ctx.allowChangeRequest) {
      throw new AppError(403, 'Change requests are turned off for this link');
    }

    // Reuse the team service's validation so a client and a team member cannot
    // produce differently-shaped rows for the same table.
    const { reviewCommentService } = await import('../organization/review-comment.service');
    const validated = reviewCommentService.validateInput({ body: input.body, anchor: input.anchor });

    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await prisma.reviewComment.findFirst({
        where: { id: input.parentId, versionId: ctx.versionId, organizationId: ctx.organizationId },
        select: { id: true, parentId: true },
      });
      if (!parent) throw new AppError(404, 'The comment being replied to was not found');
      parentId = parent.parentId ?? parent.id;
    }

    const label = (typeof input.authorLabel === 'string' && input.authorLabel.trim())
      || ctx.recipientLabel;

    const created = await prisma.reviewComment.create({
      data: {
        organizationId: ctx.organizationId,
        campaignId: ctx.campaignId,
        assetId: ctx.assetId,
        versionId: ctx.versionId,
        kind: (parentId ? 'COMMENT' : (wantsChangeRequest ? 'CHANGE_REQUEST' : 'COMMENT')) as CommentKind,
        status: 'OPEN',
        parentId,
        // The client is identified by their recipient record, never a user id.
        authorRecipientId: ctx.recipientId ?? ctx.shareLinkId,
        authorLabel: label.slice(0, 120),
        body: validated.body,
        ...(validated.anchor !== undefined ? { anchor: validated.anchor } : {}),
      },
    });

    // A change request from a client moves the version out of review — the team
    // now owes them something, and the status should say so without anyone
    // having to notice a comment.
    if (created.kind === 'CHANGE_REQUEST') {
      const version = await prisma.assetVersion.findUnique({
        where: { id: ctx.versionId },
        select: { reviewStatus: true },
      });
      if (version?.reviewStatus === 'IN_REVIEW') {
        await prisma.assetVersion.update({
          where: { id: ctx.versionId },
          data: { reviewStatus: 'CHANGES_REQUESTED' },
        });
      }
    }

    await logOrgAudit({
      organizationId: ctx.organizationId,
      actorUserId: null,
      action: created.kind === 'CHANGE_REQUEST' ? 'CHANGE_REQUEST_CREATED' : 'COMMENT_CREATED',
      entityType: 'campaign',
      entityId: ctx.campaignId,
      title: created.kind === 'CHANGE_REQUEST'
        ? `${label} requested changes on ${ctx.filename} (V${ctx.versionNumber})`
        : `${label} commented on ${ctx.filename} (V${ctx.versionNumber})`,
    });

    return {
      id: created.id,
      kind: created.kind,
      status: created.status,
      body: created.body,
      authorLabel: created.authorLabel,
      authorUserId: null,
      isClient: true,
      anchor: created.anchor ?? null,
      anchorOrphaned: created.anchorOrphaned,
      mentionedUserIds: [] as string[],
      versionId: created.versionId,
      parentId: created.parentId,
      createdAt: created.createdAt.toISOString(),
      resolvedAt: null,
      replies: [] as unknown[],
    };
  },
};
