/**
 * Campaign conversation — the team and one client, about one campaign.
 *
 * Not a chat product. Every message belongs to exactly one campaign, so two
 * clients can never see each other, and a message can be narrowed further to an
 * asset or a version so "change the logo" stays attached to the thing it is
 * about.
 *
 * Reuses the existing infrastructure rather than adding any:
 *   - realtimeHub for delivery. It is a plain string-keyed pub/sub, so a
 *     campaign channel needs no change to it at all.
 *   - platformEvents for the team's notification, which already fans out to the
 *     notification table and the user's own SSE stream.
 *
 * Unread is tracked per side. A message from the client is unread for the team
 * until the team opens the thread, and the reverse — one shared flag would let
 * either party mark the other's messages read.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { realtimeHub } from '../platform-events/realtime-hub';
import { platformEvents } from '../platform-events';

const MAX_BODY = 4000;

/**
 * Channel name for a campaign conversation.
 *
 * Namespaced so it can never collide with the user ids the hub also carries —
 * a campaign id and a user id are both uuids, and an unprefixed key would let
 * one deliver to the other.
 */
export function campaignChannel(campaignId: string): string {
  return `campaign:${campaignId}`;
}

export function cleanMessageBody(raw: unknown): string {
  if (typeof raw !== 'string') throw new AppError(400, 'A message cannot be empty');
  const text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!text) throw new AppError(400, 'A message cannot be empty');
  if (text.length > MAX_BODY) throw new AppError(400, `A message cannot be longer than ${MAX_BODY} characters`);
  return text;
}

export interface ShapedMessage {
  id: string;
  body: string;
  authorLabel: string;
  isClient: boolean;
  isSystem: boolean;
  assetId: string | null;
  versionId: string | null;
  createdAt: string;
  readByOther: boolean;
}

/**
 * `audience` decides whose "read" the sender sees, and is also why internal
 * user ids never reach a client: they are simply not in the shape.
 */
function shape(m: {
  id: string; body: string; authorLabel: string; isSystem: boolean;
  authorRecipientId: string | null; assetId: string | null; versionId: string | null;
  createdAt: Date; readByTeamAt: Date | null; readByClientAt: Date | null;
}, audience: 'team' | 'client'): ShapedMessage {
  const mine = audience === 'client' ? Boolean(m.authorRecipientId) : !m.authorRecipientId;
  return {
    id: m.id,
    body: m.body,
    authorLabel: m.authorLabel,
    isClient: Boolean(m.authorRecipientId),
    isSystem: m.isSystem,
    assetId: m.assetId,
    versionId: m.versionId,
    createdAt: m.createdAt.toISOString(),
    // Only meaningful for your own messages: has the other side seen it.
    readByOther: mine
      ? Boolean(audience === 'client' ? m.readByTeamAt : m.readByClientAt)
      : false,
  };
}

async function loadCampaignScoped(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { id: true, name: true, organizationId: true, clientId: true },
  });
  if (!campaign) throw new AppError(404, 'Campaign not found');
  return campaign;
}

export const campaignMessageService = {
  /** Conversation history for the team. */
  async listForTeam(
    organizationId: string,
    actorUserId: string,
    campaignId: string,
    filter: { assetId?: string } = {},
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    await loadCampaignScoped(organizationId, campaignId);

    const messages = await prisma.campaignMessage.findMany({
      where: { campaignId, organizationId, ...(filter.assetId ? { assetId: filter.assetId } : {}) },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    const unread = messages.filter((m) => m.authorRecipientId && !m.readByTeamAt).length;
    return { messages: messages.map((m) => shape(m, 'team')), unread };
  },

  /** Unread counts for every campaign at once — drives list badges. */
  async unreadByCampaign(organizationId: string, actorUserId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const rows = await prisma.campaignMessage.groupBy({
      by: ['campaignId'],
      where: { organizationId, readByTeamAt: null, authorRecipientId: { not: null } },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.campaignId, r._count._all]));
  },

  async sendAsTeam(
    organizationId: string,
    actorUserId: string,
    campaignId: string,
    input: { body: unknown; assetId?: string | null; versionId?: string | null },
  ) {
    // MEMBER, not VIEWER: a read-only member reads the conversation, they do
    // not speak to the client in the business's name.
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const campaign = await loadCampaignScoped(organizationId, campaignId);
    const body = cleanMessageBody(input.body);

    const author = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { fullName: true, shortId: true },
    });

    const created = await prisma.campaignMessage.create({
      data: {
        organizationId,
        campaignId,
        assetId: await validAssetForCampaign(campaignId, input.assetId),
        versionId: input.versionId ?? null,
        authorUserId: actorUserId,
        authorLabel: author?.fullName || author?.shortId || 'Team',
        body,
        // The sender has by definition seen their own side.
        readByTeamAt: new Date(),
      },
    });

    // Wake both sides: the client's campaign channel and the team's own.
    await realtimeHub.notify(campaignChannel(campaignId));
    void campaign;

    return shape(created, 'team');
  },

  /** Mark the client's messages as seen by the team. */
  async markReadByTeam(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    await loadCampaignScoped(organizationId, campaignId);
    const { count } = await prisma.campaignMessage.updateMany({
      where: { campaignId, organizationId, authorRecipientId: { not: null }, readByTeamAt: null },
      data: { readByTeamAt: new Date() },
    });
    if (count) await realtimeHub.notify(campaignChannel(campaignId));
    return { marked: count };
  },

  /**
   * A system line in the conversation — "Version 3 uploaded".
   *
   * Deliberately best-effort: a conversation entry must never be the reason a
   * version upload or an approval fails.
   */
  async postSystem(
    organizationId: string,
    campaignId: string,
    body: string,
    ctx: { assetId?: string | null; versionId?: string | null } = {},
  ) {
    try {
      await prisma.campaignMessage.create({
        data: {
          organizationId, campaignId,
          assetId: ctx.assetId ?? null,
          versionId: ctx.versionId ?? null,
          authorLabel: 'Pinit',
          isSystem: true,
          body: body.slice(0, MAX_BODY),
          // System lines are informational; neither side owes anyone a read.
          readByTeamAt: new Date(),
          readByClientAt: new Date(),
        },
      });
      await realtimeHub.notify(campaignChannel(campaignId));
    } catch {
      // swallowed on purpose — see the note above
    }
  },
};

/** Reject an assetId that does not belong to this campaign. */
async function validAssetForCampaign(campaignId: string, assetId?: string | null): Promise<string | null> {
  if (!assetId) return null;
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, campaignId },
    select: { id: true },
  });
  if (!asset) throw new AppError(404, 'That asset is not part of this campaign');
  return asset.id;
}

/**
 * Notify the team that the client said something.
 *
 * Separated so the client-facing service can call it without importing the
 * whole team service. Uses platformEvents, which already writes the
 * notification row and wakes the owner's existing SSE stream — no second
 * notification path.
 */
export async function notifyTeamOfClientMessage(input: {
  organizationId: string;
  campaignId: string;
  campaignName: string;
  assetId: string | null;
  authorLabel: string;
  body: string;
  ownerUserId: string;
}) {
  platformEvents.emit({
    name: 'campaign.message_received',
    category: 'sharing',
    severity: 'info',
    ownerUserId: input.ownerUserId,
    entityType: 'campaign',
    entityId: input.campaignId,
    title: `${input.authorLabel} sent a message about ${input.campaignName}`,
    body: input.body.slice(0, 200),
    deepLink: `/business/campaigns/${input.campaignId}?tab=messages`,
    notificationType: 'CAMPAIGN_MESSAGE',
    // Several messages in a row should be one badge, not a pile.
    dedupeKey: `campaign-message-${input.campaignId}`,
    aggregate: true,
    skipTimeline: true,
    skipAudit: true,
  });
}
