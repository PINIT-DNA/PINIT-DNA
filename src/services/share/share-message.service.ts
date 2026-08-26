/**
 * Campaign conversation, reached by a client through their secure link.
 *
 * The client never touches the Business Account. Their authority is the token,
 * and the campaign is derived from it — the same chain the review endpoints use:
 *
 *   token -> ShareLink -> assetId -> Asset.campaignId -> Campaign.organizationId
 *
 * They see the conversation for that one campaign and nothing else. No campaign
 * list, no other clients, no internal user ids.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { realtimeHub } from '../platform-events/realtime-hub';
import {
  campaignChannel, cleanMessageBody, notifyTeamOfClientMessage,
} from '../organization/campaign-message.service';
import { resolveReviewContext } from './share-review.service';

/**
 * Messaging rides on review mode.
 *
 * A plain share link stays a plain share link — turning an ordinary file share
 * into a channel to the business would be a surprise to whoever sent it.
 */
async function resolveMessagingContext(token: string) {
  const ctx = await resolveReviewContext(token);
  if (!ctx.allowComments) {
    throw new AppError(403, 'Messaging is not enabled for this link');
  }
  const campaign = await prisma.campaign.findUnique({
    where: { id: ctx.campaignId },
    select: { id: true, name: true, organizationId: true },
  });
  if (!campaign || campaign.organizationId !== ctx.organizationId) {
    throw new AppError(404, 'Messaging is not available for this link');
  }
  return { ctx, campaign };
}

/** Strip everything a client has no business seeing. */
function shapeForClient(m: {
  id: string; body: string; authorLabel: string; isSystem: boolean;
  authorRecipientId: string | null; assetId: string | null; versionId: string | null;
  createdAt: Date; readByTeamAt: Date | null;
}) {
  const mine = Boolean(m.authorRecipientId);
  return {
    id: m.id,
    body: m.body,
    authorLabel: m.authorLabel,
    isMine: mine,
    isSystem: m.isSystem,
    createdAt: m.createdAt.toISOString(),
    // Only tells the client whether the team has seen what the client sent.
    readByOther: mine ? Boolean(m.readByTeamAt) : false,
  };
}

export const shareMessageService = {
  async list(token: string) {
    const { ctx, campaign } = await resolveMessagingContext(token);

    const messages = await prisma.campaignMessage.findMany({
      where: { campaignId: ctx.campaignId, organizationId: ctx.organizationId },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    const unread = messages.filter((m) => !m.authorRecipientId && !m.isSystem && !m.readByClientAt).length;

    return {
      campaignName: campaign.name,
      recipientLabel: ctx.recipientLabel,
      messages: messages.map(shapeForClient),
      unread,
    };
  },

  async send(token: string, input: { body?: unknown; authorLabel?: unknown }) {
    const { ctx, campaign } = await resolveMessagingContext(token);
    const body = cleanMessageBody(input.body);

    const link = await prisma.shareLink.findUnique({
      where: { token },
      select: { id: true, shareRecipientId: true },
    });

    const label = (typeof input.authorLabel === 'string' && input.authorLabel.trim())
      || ctx.recipientLabel;

    const created = await prisma.campaignMessage.create({
      data: {
        organizationId: ctx.organizationId,
        campaignId: ctx.campaignId,
        // Anchored to the asset they were actually looking at, so the team sees
        // what the message is about without having to ask.
        assetId: ctx.assetId,
        versionId: ctx.versionId,
        authorRecipientId: link?.shareRecipientId ?? link?.id ?? ctx.shareLinkId,
        authorLabel: label.slice(0, 120),
        body,
        readByClientAt: new Date(),
      },
    });

    // Wake anyone watching this campaign — the team's panel and any other
    // open client view.
    await realtimeHub.notify(campaignChannel(ctx.campaignId));

    // Notify the team through the existing event engine.
    const owner = await prisma.asset.findUnique({
      where: { id: ctx.assetId },
      select: { ownerUserId: true },
    });
    if (owner) {
      await notifyTeamOfClientMessage({
        organizationId: ctx.organizationId,
        campaignId: ctx.campaignId,
        campaignName: campaign.name,
        assetId: ctx.assetId,
        authorLabel: label,
        body,
        ownerUserId: owner.ownerUserId,
      });
    }

    return shapeForClient(created);
  },

  /** Mark the team's messages as seen by the client. */
  async markRead(token: string) {
    const { ctx } = await resolveMessagingContext(token);
    const { count } = await prisma.campaignMessage.updateMany({
      where: {
        campaignId: ctx.campaignId,
        organizationId: ctx.organizationId,
        authorRecipientId: null,
        isSystem: false,
        readByClientAt: null,
      },
      data: { readByClientAt: new Date() },
    });
    if (count) await realtimeHub.notify(campaignChannel(ctx.campaignId));
    return { marked: count };
  },

  /**
   * Resolve the campaign channel for a token, for the SSE stream.
   *
   * Kept separate so the stream can subscribe without loading any messages.
   */
  async channelFor(token: string) {
    const { ctx } = await resolveMessagingContext(token);
    return { channel: campaignChannel(ctx.campaignId), campaignId: ctx.campaignId };
  },
};
