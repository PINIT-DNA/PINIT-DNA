/**
 * Client-level rollups.
 *
 * A client is a collection of campaigns, so everything here is the campaign-level
 * answer asked across all of them. Nothing is stored, nothing is recomputed from
 * raw tables, and no per-client copy of any record exists: each rollup calls the
 * SAME service the campaign tab calls and merges the results.
 *
 * That is slower than a bespoke query and it is the right trade. The rules about
 * what a rights state means, which handover counts as live, and how a finding is
 * described all live in one place. A second query written here would drift from
 * them within a month, and the client view would quietly start disagreeing with
 * the campaign view it is meant to summarise.
 *
 * Scoping is inherited rather than re-derived: campaigns are looked up by
 * `{ clientId, organizationId }`, and every downstream call re-checks the
 * caller's role for itself.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { campaignHandoverService } from './campaign-handover.service';
import { campaignRightsService } from './campaign-rights.service';
import { campaignIntelligenceService } from './campaign-intelligence.service';

/** Campaigns are the unit of work; a client view is the sum of theirs. */
async function clientCampaigns(organizationId: string, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId },
    select: { id: true, name: true },
  });
  if (!client) throw new AppError(404, 'Client not found');

  const campaigns = await prisma.campaign.findMany({
    where: { clientId, organizationId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, status: true },
  });
  return { client, campaigns };
}

/**
 * Run a per-campaign call across a client's campaigns.
 *
 * One campaign failing must not blank the whole page — a client with six
 * campaigns and one problem should still see the other five, and be told the
 * count is partial rather than shown a wrong total silently.
 */
async function acrossCampaigns<T>(
  campaigns: { id: string; name: string }[],
  fn: (campaignId: string) => Promise<T>,
): Promise<{ results: { campaign: { id: string; name: string }; value: T }[]; failed: number }> {
  const settled = await Promise.allSettled(campaigns.map((c) => fn(c.id)));
  const results: { campaign: { id: string; name: string }; value: T }[] = [];
  let failed = 0;
  settled.forEach((s, i) => {
    const campaign = campaigns[i];
    if (s.status === 'fulfilled' && campaign) {
      results.push({ campaign: { id: campaign.id, name: campaign.name }, value: s.value });
    } else {
      failed += 1;
    }
  });
  return { results, failed };
}

export const clientAggregateService = {
  /**
   * Everything handed to this client, across their campaigns.
   *
   * Reuses campaignHandoverService.list — the handover record IS the delivery
   * record, so there is nothing separate to build.
   */
  async deliveries(organizationId: string, actorUserId: string, clientId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const { client, campaigns } = await clientCampaigns(organizationId, clientId);

    const { results, failed } = await acrossCampaigns(campaigns, (id) =>
      campaignHandoverService.list(organizationId, actorUserId, id));

    const deliveries = results
      .flatMap(({ campaign, value }) => value.map((h) => ({ ...h, campaign })))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const now = Date.now();
    const isLive = (d: (typeof deliveries)[number]) =>
      !d.revokedAt && (!d.expiresAt || new Date(d.expiresAt).getTime() > now);

    return {
      clientName: client.name,
      campaignCount: campaigns.length,
      partial: failed > 0,
      deliveries,
      counts: {
        total: deliveries.length,
        live: deliveries.filter(isLive).length,
        opened: deliveries.filter((d) => d.openCount > 0).length,
        awaitingOpen: deliveries.filter((d) => d.sentAt && d.openCount === 0).length,
        revoked: deliveries.filter((d) => d.revokedAt).length,
        assetsDelivered: new Set(
          deliveries.flatMap((d) => d.assets.map((a) => a.assetId)),
        ).size,
      },
    };
  },

  /**
   * Usage rights across the client's work.
   *
   * Reuses campaignRightsService, which reads Exchange read-only. No licensing
   * state is computed here — Exchange remains the source of truth, and when it
   * cannot be reached that is reported rather than guessed around.
   */
  async rights(organizationId: string, actorUserId: string, clientId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const { client, campaigns } = await clientCampaigns(organizationId, clientId);

    const { results, failed } = await acrossCampaigns(campaigns, (id) =>
      campaignRightsService.listForCampaign(organizationId, actorUserId, id));

    const assets = results.flatMap(({ campaign, value }) =>
      value.assets.map((a) => ({ ...a, campaign })));

    // If any campaign could not reach Exchange, say so — a page full of
    // "no rights recorded" is indistinguishable from an outage otherwise.
    const exchangeReachable = results.every((r) => r.value.exchangeReachable !== false);

    const byState: Record<string, number> = {};
    for (const a of assets) {
      const state = (a as { rights?: { state?: string } }).rights?.state ?? 'UNKNOWN';
      byState[state] = (byState[state] ?? 0) + 1;
    }

    return {
      clientName: client.name,
      campaignCount: campaigns.length,
      partial: failed > 0,
      exchangeReachable,
      assets,
      counts: { total: assets.length, byState },
    };
  },

  /**
   * What has happened across this client's campaigns.
   *
   * Reads the existing organization audit log, scoped to this client's campaign
   * ids. No second activity store: the audit log already records every action
   * these services take.
   */
  async activity(
    organizationId: string,
    actorUserId: string,
    clientId: string,
    limit = 100,
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const { client, campaigns } = await clientCampaigns(organizationId, clientId);

    const campaignIds = campaigns.map((c) => c.id);
    const nameById = new Map(campaigns.map((c) => [c.id, c.name]));

    // Entries about the campaigns, plus entries about the client record itself.
    const rows = campaignIds.length || clientId
      ? await prisma.organizationAuditLog.findMany({
          where: {
            organizationId,
            OR: [
              ...(campaignIds.length
                ? [{ entityType: 'campaign', entityId: { in: campaignIds } }]
                : []),
              { entityType: 'client', entityId: clientId },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: Math.min(limit, 200),
        })
      : [];

    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => Boolean(v)))];
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const actorById = new Map(actors.map((a) => [a.id, a.fullName ?? 'Team member']));

    return {
      clientName: client.name,
      campaignCount: campaigns.length,
      entries: rows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        action: r.action,
        title: r.title,
        // A name, never an id or an email.
        actor: r.actorUserId ? (actorById.get(r.actorUserId) ?? 'Team member') : 'System',
        campaignId: r.entityType === 'campaign' ? r.entityId : null,
        campaignName: r.entityType === 'campaign' && r.entityId
          ? (nameById.get(r.entityId) ?? null)
          : null,
      })),
    };
  },

  /**
   * The client's whole picture.
   *
   * Reuses campaignIntelligenceService per campaign and sums it. The discovery
   * capability is carried up unchanged, because a total of zero findings means
   * something completely different depending on whether anything is looking —
   * and that caveat has to survive the rollup.
   */
  async intelligence(organizationId: string, actorUserId: string, clientId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const { client, campaigns } = await clientCampaigns(organizationId, clientId);

    const { results, failed } = await acrossCampaigns(campaigns, (id) =>
      campaignIntelligenceService.getForCampaign(organizationId, actorUserId, id));

    type Intel = Awaited<ReturnType<typeof campaignIntelligenceService.getForCampaign>>;
    const values = results.map((r) => r.value as Intel);

    const sum = (pick: (i: Intel) => number | undefined) =>
      values.reduce((n, v) => n + (pick(v) ?? 0), 0);

    return {
      clientName: client.name,
      campaignCount: campaigns.length,
      partial: failed > 0,
      campaigns: results.map(({ campaign, value }) => ({
        id: campaign.id,
        name: campaign.name,
        assets: (value as Intel).protection?.assets ?? 0,
        findings: (value as Intel).findings?.total ?? 0,
        monitored: (value as Intel).monitoring?.monitored ?? 0,
      })),
      totals: {
        assets: sum((i) => i.protection?.assets),
        withDna: sum((i) => i.protection?.withDna),
        withVault: sum((i) => i.protection?.withVault),
        withCertificate: sum((i) => i.protection?.withCertificate),
        monitored: sum((i) => i.monitoring?.monitored),
        findings: sum((i) => i.findings?.total),
        findingsConfirmed: sum((i) => i.findings?.confirmed),
        findingsNeedsReview: sum((i) => i.findings?.needsReview),
      },
      /**
       * Carried up from the campaign layer untouched. Whether discovery is
       * actually working decides how the findings total should be read.
       */
      discovery: values[0]?.monitoring?.capability ?? null,
    };
  },
};
