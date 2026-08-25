/**
 * Business Account — review comments and change requests.
 *
 * One table, two behaviours. A CHANGE_REQUEST is actionable and carries a
 * lifecycle; a COMMENT is discussion. Keeping them in one table with a `kind`
 * discriminator means the team has one inbox and the client has one mental
 * model, while queries and UI can still treat them differently.
 *
 * Everything is anchored to a version, never to an asset alone: "change this
 * heading" is meaningless once V2 has changed the heading.
 *
 * Threads are one level deep. A reply to a reply is stored against the same
 * root, because deeper nesting produces threads nobody can follow in a review
 * panel.
 */
import type { CommentKind, CommentStatus, Prisma, ReviewComment } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';

/**
 * Statuses a change request may move between.
 *
 * RESOLVED / REJECTED / CLOSED are terminal — reopening is done by raising a
 * new request, so the record of what was decided is never rewritten.
 */
const ALLOWED_STATUS: Record<CommentStatus, CommentStatus[]> = {
  OPEN:        ['IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'REJECTED', 'CLOSED', 'OPEN'],
  RESOLVED:    [],
  REJECTED:    [],
  CLOSED:      [],
};

export function canChangeStatus(from: CommentStatus, to: CommentStatus): boolean {
  return ALLOWED_STATUS[from]?.includes(to) ?? false;
}

const MAX_BODY = 10_000;

/** Strip control characters and cap length. Rendering escapes separately. */
function cleanBody(raw: unknown): string {
  if (typeof raw !== 'string') throw new AppError(400, 'A comment needs a message');
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!text) throw new AppError(400, 'A comment needs a message');
  if (text.length > MAX_BODY) throw new AppError(400, `A comment cannot be longer than ${MAX_BODY} characters`);
  return text;
}

/**
 * Validate the anchor shape rather than storing whatever arrives.
 *
 * An unvalidated JSON column becomes a dumping ground, and the viewer would
 * then have to defend against every shape at render time.
 */
function cleanAnchor(raw: unknown): Prisma.InputJsonValue | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'object') throw new AppError(400, 'Invalid comment location');
  const a = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  switch (a.type) {
    case 'page': {
      const page = num(a.page);
      if (page === null || page < 1) throw new AppError(400, 'Invalid page number');
      return { type: 'page', page };
    }
    case 'coordinate': {
      const x = num(a.x); const y = num(a.y);
      if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1) {
        throw new AppError(400, 'Invalid image position');
      }
      return { type: 'coordinate', x, y };
    }
    case 'timestamp': {
      const seconds = num(a.seconds);
      if (seconds === null || seconds < 0) throw new AppError(400, 'Invalid video timestamp');
      return { type: 'timestamp', seconds };
    }
    case 'text': {
      const quote = typeof a.quote === 'string' ? a.quote.slice(0, 500) : '';
      if (!quote) throw new AppError(400, 'Invalid text selection');
      const page = num(a.page);
      return {
        type: 'text',
        quote,
        ...(page !== null ? { page } : {}),
        ...(typeof a.prefix === 'string' ? { prefix: a.prefix.slice(0, 200) } : {}),
        ...(typeof a.suffix === 'string' ? { suffix: a.suffix.slice(0, 200) } : {}),
      };
    }
    default:
      throw new AppError(400, 'Unsupported comment location');
  }
}

/** Load a version and prove it belongs to this organization. */
async function loadVersionScoped(organizationId: string, versionId: string) {
  const version = await prisma.assetVersion.findFirst({
    where: { id: versionId, organizationId },
    select: { id: true, assetId: true, campaignId: true, versionNumber: true,
              originalFilename: true, organizationId: true },
  });
  if (!version) throw new AppError(404, 'Version not found');
  return version;
}

/**
 * Keep only mentions that are real members of this organization.
 *
 * A mention is a notification trigger, so an unchecked list would let anyone
 * ping arbitrary user ids across tenants.
 */
async function validMentions(organizationId: string, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const wanted = [...new Set(ids.filter((i): i is string => typeof i === 'string'))].slice(0, 20);
  if (!wanted.length) return [];
  const members = await prisma.organizationMember.findMany({
    where: { organizationId, userId: { in: wanted } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

type CommentRow = ReviewComment;

export interface ShapedComment {
  id: string;
  kind: CommentKind;
  status: CommentStatus;
  body: string;
  authorLabel: string;
  authorUserId: string | null;
  isClient: boolean;
  anchor: unknown;
  anchorOrphaned: boolean;
  mentionedUserIds: string[];
  versionId: string;
  parentId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  replies: ShapedComment[];
}

function shape(c: CommentRow, replies: CommentRow[] = []): ShapedComment {
  return {
    id: c.id,
    kind: c.kind,
    status: c.status,
    body: c.body,
    authorLabel: c.authorLabel,
    authorUserId: c.authorUserId,
    isClient: Boolean(c.authorRecipientId),
    anchor: c.anchor ?? null,
    anchorOrphaned: c.anchorOrphaned,
    mentionedUserIds: c.mentionedUserIds,
    versionId: c.versionId,
    parentId: c.parentId,
    createdAt: c.createdAt.toISOString(),
    resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    replies: replies.map((r) => shape(r)),
  };
}

export const reviewCommentService = {
  /**
   * Shared body/anchor validation.
   *
   * Exposed so the client-facing share-review path reuses exactly this, rather
   * than growing a second validator that could drift and let a client write a
   * row the team path would have refused.
   */
  validateInput(input: { body?: unknown; anchor?: unknown }) {
    return { body: cleanBody(input.body), anchor: cleanAnchor(input.anchor) };
  },

  /** Threads for one version, roots with their replies nested. */
  async listForVersion(
    organizationId: string,
    actorUserId: string,
    versionId: string,
    filter: { status?: CommentStatus; kind?: CommentKind } = {},
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    await loadVersionScoped(organizationId, versionId);

    const all = await prisma.reviewComment.findMany({
      where: { versionId, organizationId },
      orderBy: { createdAt: 'asc' },
    });

    const repliesByParent = new Map<string, CommentRow[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const list = repliesByParent.get(c.parentId) ?? [];
      list.push(c);
      repliesByParent.set(c.parentId, list);
    }

    // Filters apply to threads, not replies — hiding a reply because its status
    // differs would leave a conversation with holes in it.
    const roots = all.filter((c) => !c.parentId
      && (!filter.status || c.status === filter.status)
      && (!filter.kind || c.kind === filter.kind));

    const counts = all.reduce(
      (acc, c) => {
        if (c.parentId) return acc;
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
      comments: roots.map((r) => shape(r, repliesByParent.get(r.id) ?? [])),
      counts,
    };
  },

  /** Open change requests across a campaign — drives Needs Attention. */
  async listOpenChangeRequests(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const rows = await prisma.reviewComment.findMany({
      where: {
        organizationId, campaignId,
        kind: 'CHANGE_REQUEST',
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        parentId: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => shape(r));
  },

  async create(
    organizationId: string,
    actorUserId: string,
    versionId: string,
    input: {
      body: string;
      kind?: CommentKind;
      parentId?: string | null;
      anchor?: unknown;
      mentionedUserIds?: unknown;
      authorLabel?: string;
    },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const version = await loadVersionScoped(organizationId, versionId);

    const body = cleanBody(input.body);
    const anchor = cleanAnchor(input.anchor);
    const mentions = await validMentions(organizationId, input.mentionedUserIds);

    // A reply inherits its root's thread. Nesting is flattened to one level.
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = await prisma.reviewComment.findFirst({
        where: { id: input.parentId, organizationId, versionId },
        select: { id: true, parentId: true },
      });
      if (!parent) throw new AppError(404, 'The comment being replied to was not found');
      parentId = parent.parentId ?? parent.id;
    }

    const author = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { fullName: true, shortId: true },
    });

    const created = await prisma.reviewComment.create({
      data: {
        organizationId,
        campaignId: version.campaignId ?? '',
        assetId: version.assetId,
        versionId,
        kind: parentId ? 'COMMENT' : (input.kind ?? 'COMMENT'),
        status: 'OPEN',
        parentId,
        authorUserId: actorUserId,
        authorLabel: input.authorLabel?.trim() || author?.fullName || author?.shortId || 'Team member',
        body,
        mentionedUserIds: mentions,
        ...(anchor !== undefined ? { anchor } : {}),
      },
    });

    if (version.campaignId) {
      await logOrgAudit({
        organizationId,
        actorUserId,
        action: created.kind === 'CHANGE_REQUEST' ? 'CHANGE_REQUEST_CREATED' : 'COMMENT_CREATED',
        entityType: 'campaign',
        entityId: version.campaignId,
        title: created.kind === 'CHANGE_REQUEST'
          ? `Changes requested on ${version.originalFilename} (V${version.versionNumber})`
          : `Comment on ${version.originalFilename} (V${version.versionNumber})`,
      });
    }

    return shape(created);
  },

  async setStatus(
    organizationId: string,
    actorUserId: string,
    commentId: string,
    next: CommentStatus,
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);

    const comment = await prisma.reviewComment.findFirst({
      where: { id: commentId, organizationId },
    });
    if (!comment) throw new AppError(404, 'Comment not found');
    if (comment.parentId) throw new AppError(400, 'Replies do not carry a status — set it on the thread');
    if (comment.status === next) return shape(comment);

    if (!canChangeStatus(comment.status, next)) {
      throw new AppError(
        409,
        `This is already ${comment.status.replace(/_/g, ' ').toLowerCase()} and cannot be changed. ` +
        'Raise a new request instead.',
      );
    }

    const done = next === 'RESOLVED' || next === 'REJECTED' || next === 'CLOSED';
    const updated = await prisma.reviewComment.update({
      where: { id: commentId },
      data: {
        status: next,
        resolvedAt: done ? new Date() : null,
        resolvedByUserId: done ? actorUserId : null,
      },
    });

    if (comment.campaignId) {
      await logOrgAudit({
        organizationId,
        actorUserId,
        action: `COMMENT_${next}`,
        entityType: 'campaign',
        entityId: comment.campaignId,
        title: `${comment.kind === 'CHANGE_REQUEST' ? 'Change request' : 'Comment'} ${next.toLowerCase()}`,
      });
    }

    return shape(updated);
  },

  /**
   * Mark anchors orphaned when a new version lands.
   *
   * The anchor pointed into the previous file; the text it named may not exist
   * any more. The quote stays on the comment so the reader still sees what was
   * meant — we just stop claiming to know where it is.
   */
  async orphanAnchorsForVersion(versionId: string) {
    // `NOT: { anchor: DbNull }` is rejected by Prisma's typing, so the rows
    // carrying an anchor are selected first and then updated by id.
    const anchored = await prisma.reviewComment.findMany({
      where: { versionId, anchorOrphaned: false },
      select: { id: true, anchor: true },
    });
    const ids = anchored.filter((c) => c.anchor !== null).map((c) => c.id);
    if (!ids.length) return 0;
    const { count } = await prisma.reviewComment.updateMany({
      where: { id: { in: ids } },
      data: { anchorOrphaned: true },
    });
    return count;
  },
};
