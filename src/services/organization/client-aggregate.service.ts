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
import { campaignAccessService } from './campaign-access.service';

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
   * Every asset across this client's campaigns.
   *
   * Reuses campaignRightsService, which already assembles protection, review and
   * licence state per asset, and campaignHandoverService for what has actually
   * been delivered. No second asset query and no second asset store — Asset
   * stays the only record, read through the services that already interpret it.
   */
  async assets(organizationId: string, actorUserId: string, clientId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const { client, campaigns } = await clientCampaigns(organizationId, clientId);

    const [rights, handovers] = await Promise.all([
      acrossCampaigns(campaigns, (id) =>
        campaignRightsService.listForCampaign(organizationId, actorUserId, id)),
      acrossCampaigns(campaigns, (id) =>
        campaignHandoverService.list(organizationId, actorUserId, id)),
    ]);

    // Which assets have gone to the client, and whether that access still works.
    const deliveredLive = new Set<string>();
    const deliveredEver = new Set<string>();
    const now = Date.now();
    for (const { value } of handovers.results) {
      for (const h of value) {
        const live = !h.revokedAt && (!h.expiresAt || new Date(h.expiresAt).getTime() > now);
        for (const a of h.assets) {
          deliveredEver.add(a.assetId);
          if (live) deliveredLive.add(a.assetId);
        }
      }
    }

    const assets = rights.results.flatMap(({ campaign, value }) =>
      value.assets.map((a) => {
        const row = a as unknown as {
          assetId: string; filename: string; assetType: string | null; addedAt: string;
          protection: { hasDna: boolean; hasVault: boolean; certificateId: string | null };
          review: { currentVersion: number | null; reviewStatus: string | null; versionCount: number };
          rightsState?: string;
        };
        return {
          assetId: row.assetId,
          filename: row.filename,
          assetType: row.assetType,
          addedAt: row.addedAt,
          campaign: { id: campaign.id, name: campaign.name },
          protection: {
            hasDna: row.protection.hasDna,
            hasVault: row.protection.hasVault,
            hasCertificate: Boolean(row.protection.certificateId),
            /** All three present is what "fully protected" means here. */
            complete: row.protection.hasDna && row.protection.hasVault
              && Boolean(row.protection.certificateId),
          },
          review: {
            currentVersion: row.review.currentVersion,
            versionCount: row.review.versionCount,
            reviewStatus: row.review.reviewStatus,
            isApproved: row.review.reviewStatus === 'APPROVED',
          },
          rightsState: row.rightsState ?? 'UNKNOWN',
          handover: {
            delivered: deliveredEver.has(row.assetId),
            /** Delivered but the link no longer opens — revoked or expired. */
            accessLive: deliveredLive.has(row.assetId),
          },
          /** Opens the asset in the campaign it belongs to, not a list page. */
          deepLink: '/business/campaigns/' + campaign.id + '?tab=assets&asset=' + row.assetId,
        };
      }),
    ).sort((a, b) => b.addedAt.localeCompare(a.addedAt));

    const byCampaign = campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      count: assets.filter((a) => a.campaign.id === c.id).length,
    }));

    return {
      clientName: client.name,
      campaignCount: campaigns.length,
      partial: rights.failed > 0 || handovers.failed > 0,
      assets,
      byCampaign,
      counts: {
        total: assets.length,
        fullyProtected: assets.filter((a) => a.protection.complete).length,
        approved: assets.filter((a) => a.review.isApproved).length,
        delivered: assets.filter((a) => a.handover.delivered).length,
        deliveredLive: assets.filter((a) => a.handover.accessLive).length,
      },
    };
  },

  /**
   * Everyone involved in this client's work.
   *
   * Reuses campaignAccessService.listPeople per campaign — the same call the
   * campaign People tab makes — and merges by identity, so one person working
   * three campaigns reads as one person with three campaigns rather than three
   * separate rows.
   *
   * Nothing here reads OrganizationMember directly for the list. A colleague who
   * has never touched this client's work is not involved with this client, and
   * listing the whole organization would be exactly the generic-list mistake.
   */
  async people(organizationId: string, actorUserId: string, clientId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const { client, campaigns } = await clientCampaigns(organizationId, clientId);

    const { results, failed } = await acrossCampaigns(campaigns, (id) =>
      campaignAccessService.listPeople(organizationId, actorUserId, id));

    type Person = Awaited<ReturnType<typeof campaignAccessService.listPeople>>['people'][number];

    /** One row per human. shortId identifies staff; email or name an outsider. */
    const keyFor = (p: Person) =>
      p.shortId ? 'u:' + p.shortId
        : p.email ? 'e:' + p.email.toLowerCase()
        : 'n:' + p.name;

    const merged = new Map<string, {
      key: string; kind: 'internal' | 'external'; name: string;
      shortId: string | null; email: string | null; orgRole: string | null;
      roleLabels: string[];
      campaigns: { id: string; name: string; accessStatus: string; roleLabel: string | null }[];
      assets: { assetId: string; filename: string; campaignId: string }[];
      lastAccessAt: string | null;
      addedAt: string;
    }>();

    for (const { campaign, value } of results) {
      for (const p of value.people) {
        const key = keyFor(p);
        const entry = merged.get(key) ?? {
          key,
          kind: p.kind,
          name: p.name,
          shortId: p.shortId,
          email: p.email,
          orgRole: p.orgRole,
          roleLabels: [] as string[],
          campaigns: [] as { id: string; name: string; accessStatus: string; roleLabel: string | null }[],
          assets: [] as { assetId: string; filename: string; campaignId: string }[],
          lastAccessAt: p.lastAccessAt,
          addedAt: p.addedAt,
        };

        entry.campaigns.push({
          id: campaign.id, name: campaign.name,
          accessStatus: p.accessStatus, roleLabel: p.roleLabel,
        });
        if (p.roleLabel && !entry.roleLabels.includes(p.roleLabel)) {
          entry.roleLabels.push(p.roleLabel);
        }
        for (const a of p.assets) {
          entry.assets.push({ assetId: a.assetId, filename: a.filename, campaignId: campaign.id });
        }
        // Keep the most recent access and the earliest involvement.
        if (p.lastAccessAt && (!entry.lastAccessAt || p.lastAccessAt > entry.lastAccessAt)) {
          entry.lastAccessAt = p.lastAccessAt;
        }
        if (p.addedAt < entry.addedAt) entry.addedAt = p.addedAt;

        merged.set(key, entry);
      }
    }

    const people = [...merged.values()]
      .map((p) => ({
        ...p,
        campaignCount: p.campaigns.length,
        assetCount: p.assets.length,
        /** External access is live only where at least one campaign says so. */
        hasLiveAccess: p.kind === 'internal'
          || p.campaigns.some((c) => c.accessStatus === 'ACTIVE'),
      }))
      .sort((a, b) => (b.campaignCount - a.campaignCount) || a.name.localeCompare(b.name));

    return {
      clientName: client.name,
      campaignCount: campaigns.length,
      partial: failed > 0,
      /** The client's own contact, from the client record, not a member row. */
      clientContact: results[0]?.value.client ?? null,
      people,
      counts: {
        total: people.length,
        internal: people.filter((p) => p.kind === 'internal').length,
        external: people.filter((p) => p.kind === 'external').length,
        externalLive: people.filter((p) => p.kind === 'external' && p.hasLiveAccess).length,
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

    // campaignRightsService returns `rightsState` at the top of each asset, not
    // a nested `rights.state`. Reading the wrong path silently bucketed every
    // asset as UNKNOWN, which a breakdown that only has to sum correctly will
    // never reveal.
    const byState: Record<string, number> = {};
    for (const a of assets) {
      const state = (a as { rightsState?: string }).rightsState ?? 'UNKNOWN';
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
