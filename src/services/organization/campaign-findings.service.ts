/**
 * Findings — external discoveries for a campaign's assets.
 *
 * Reads AssetDiscovery, which the existing pipeline already writes:
 *
 *   crawler → CrawlResult → notifyPublishGuardianOfMatch (skipped on NO_MATCH)
 *           → recordDiscoveryFromMonitor → assetService.recordDiscovery
 *           → AssetDiscovery
 *
 * That chain is intact and only fires on a real match, which is why the table is
 * currently empty: no provider has produced one. Nothing here creates a row, and
 * an empty result is rendered as an honest empty state rather than padded.
 *
 * The review lifecycle reuses the alertStatus vocabulary that already exists —
 * PENDING → CONFIRMED | DISMISSED — rather than introducing parallel states.
 *
 * A finding is never called infringement. It is a match with a confidence and a
 * source; deciding what it means is a person's job, and the wording throughout
 * keeps that boundary.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import { emitFindingConfirmed } from '../platform-events';

/** The states a finding moves through. PENDING is the engine's default. */
export type FindingStatus = 'PENDING' | 'CONFIRMED' | 'DISMISSED';

const TERMINAL: FindingStatus[] = ['CONFIRMED', 'DISMISSED'];

/**
 * How strong a match is, in the same bands the comparison engine uses.
 *
 * Deliberately descriptive rather than conclusive: "looks identical" is an
 * observation, "infringing" is a legal judgement this system does not make.
 */
function describeMatch(similarity: number): { band: string; label: string; meaning: string } {
  if (similarity >= 0.95) {
    return {
      band: 'EXACT_MATCH', label: 'Looks identical',
      meaning: 'Visually indistinguishable from your asset. Worth reviewing first.',
    };
  }
  if (similarity >= 0.85) {
    return {
      band: 'HIGH_MATCH', label: 'Very close',
      meaning: 'Close enough that a crop, resize or light edit would explain it.',
    };
  }
  if (similarity >= 0.70) {
    return {
      band: 'POSSIBLE_MATCH', label: 'Possibly related',
      meaning: 'Some shared characteristics. May be coincidental — check before acting.',
    };
  }
  return {
    band: 'WEAK', label: 'Weak signal',
    meaning: 'Low similarity. Most likely unrelated.',
  };
}

async function loadCampaignScoped(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { id: true, name: true },
  });
  if (!campaign) throw new AppError(404, 'Campaign not found');
  return campaign;
}

/** Prove a finding belongs to this organization, through its asset's campaign. */
async function loadFindingScoped(organizationId: string, findingId: string) {
  const finding = await prisma.assetDiscovery.findUnique({
    where: { id: findingId },
    select: {
      id: true, assetId: true, url: true, alertStatus: true, similarity: true,
      asset: {
        select: {
          id: true, originalFilename: true, campaignId: true,
          campaign: { select: { id: true, organizationId: true } },
        },
      },
    },
  });
  if (!finding?.asset?.campaign || finding.asset.campaign.organizationId !== organizationId) {
    throw new AppError(404, 'Finding not found');
  }
  return finding;
}

export const campaignFindingsService = {
  /**
   * Findings for a campaign, newest first.
   *
   * Returns an empty list honestly. The caller is told how many assets are
   * actually being monitored, so "no findings" can be read correctly — nothing
   * found is very different from nothing looked for.
   */
  async listForCampaign(
    organizationId: string,
    actorUserId: string,
    campaignId: string,
    filter: { status?: FindingStatus; assetId?: string } = {},
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const campaign = await loadCampaignScoped(organizationId, campaignId);

    const assets = await prisma.asset.findMany({
      where: { campaignId },
      select: { id: true, originalFilename: true, dnaId: true },
    });
    const assetIds = assets.map((a) => a.id);
    const nameById = new Map(assets.map((a) => [a.id, a.originalFilename]));

    if (assetIds.length === 0) {
      return {
        campaignName: campaign.name,
        findings: [],
        counts: { total: 0, pending: 0, confirmed: 0, dismissed: 0 },
        context: { assetsInCampaign: 0, assetsMonitored: 0 },
      };
    }

    const dnaIds = assets.map((a) => a.dnaId).filter((d): d is string => Boolean(d));
    const [rows, monitoredCount] = await Promise.all([
      prisma.assetDiscovery.findMany({
        where: {
          assetId: { in: assetIds },
          ...(filter.status ? { alertStatus: filter.status } : {}),
          ...(filter.assetId ? { assetId: filter.assetId } : {}),
        },
        orderBy: [{ similarity: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      }),
      dnaIds.length
        ? prisma.monitorRecord.count({ where: { dnaRecordId: { in: dnaIds }, status: 'ACTIVE' } })
        : Promise.resolve(0),
    ]);

    // Counts come from the whole set, not the filtered view, so the tabs stay
    // stable while filtering.
    const all = filter.status || filter.assetId
      ? await prisma.assetDiscovery.findMany({
          where: { assetId: { in: assetIds } },
          select: { alertStatus: true },
        })
      : rows.map((r) => ({ alertStatus: r.alertStatus }));

    return {
      campaignName: campaign.name,
      findings: rows.map((d) => {
        const match = describeMatch(d.similarity);
        return {
          id: d.id,
          assetId: d.assetId,
          assetName: nameById.get(d.assetId) ?? 'Unknown asset',
          status: d.alertStatus as FindingStatus,
          url: d.url,
          platform: d.platform ?? d.sourcePlatform ?? null,
          pageTitle: d.pageTitle,
          similarity: d.similarity,
          confidence: d.confidence,
          severity: d.severity,
          riskScore: d.riskScore,
          tampered: d.tampered,
          tampering: d.tampering,
          matchBand: match.band,
          matchLabel: match.label,
          matchMeaning: match.meaning,
          firstSeen: d.firstSeen.toISOString(),
          lastSeen: d.lastSeen.toISOString(),
          createdAt: d.createdAt.toISOString(),
          /** Set once an investigation exists — layer 5 will populate this. */
          investigationId: d.investigationId,
        };
      }),
      counts: {
        total: all.length,
        pending: all.filter((d) => d.alertStatus === 'PENDING').length,
        confirmed: all.filter((d) => d.alertStatus === 'CONFIRMED').length,
        dismissed: all.filter((d) => d.alertStatus === 'DISMISSED').length,
      },
      /** Lets the UI say why there is nothing, rather than just showing nothing. */
      context: { assetsInCampaign: assets.length, assetsMonitored: monitoredCount },
    };
  },

  /**
   * Record a person's decision about a finding.
   *
   * CONFIRMED and DISMISSED are terminal. Reversing one means raising it again
   * deliberately, not toggling — the same reasoning that makes an approved
   * version terminal. A confirmed finding may later carry an investigation, so
   * silently flipping it would strand that work.
   */
  async decide(
    organizationId: string,
    actorUserId: string,
    findingId: string,
    status: FindingStatus,
    note?: string,
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    const finding = await loadFindingScoped(organizationId, findingId);

    if (!TERMINAL.includes(status)) {
      throw new AppError(400, 'A finding can only be confirmed or dismissed');
    }
    if (TERMINAL.includes(finding.alertStatus as FindingStatus)) {
      throw new AppError(
        409,
        `This finding was already ${finding.alertStatus.toLowerCase()}. `
        + 'Reopening is deliberate — raise it again rather than toggling.',
      );
    }

    const updated = await prisma.assetDiscovery.update({
      where: { id: findingId },
      data: { alertStatus: status },
    });

    const campaignId = finding.asset.campaign!.id;
    await logOrgAudit({
      organizationId, actorUserId,
      action: status === 'CONFIRMED' ? 'FINDING_CONFIRMED' : 'FINDING_DISMISSED',
      entityType: 'campaign', entityId: campaignId,
      title: status === 'CONFIRMED'
        ? `Match confirmed on ${finding.asset.originalFilename}`
        : `Match dismissed on ${finding.asset.originalFilename}`,
      detail: { findingId, url: finding.url, note: note ?? null },
    });

    // Only a confirmation is announced. A dismissal is the team agreeing there
    // is nothing there, and broadcasting that is how a badge becomes noise.
    if (status === 'CONFIRMED') {
      let host: string | null = null;
      try { host = new URL(finding.url).hostname; } catch { host = null; }
      await emitFindingConfirmed({
        campaignId,
        campaignName: '',
        assetName: finding.asset.originalFilename,
        host,
        findingId: finding.id,
        actorUserId,
      });
    }

    return {
      id: updated.id,
      status: updated.alertStatus as FindingStatus,
    };
  },

  /**
   * One finding in full, for the detail view.
   *
   * Includes the protection facts that make the match meaningful — which asset,
   * which DNA record — without exposing the fingerprint itself.
   */
  async get(organizationId: string, actorUserId: string, findingId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const scoped = await loadFindingScoped(organizationId, findingId);

    const d = await prisma.assetDiscovery.findUnique({ where: { id: findingId } });
    if (!d) throw new AppError(404, 'Finding not found');

    const asset = await prisma.asset.findUnique({
      where: { id: d.assetId },
      select: {
        id: true, originalFilename: true, assetType: true,
        dnaId: true, vaultId: true, certificateId: true, createdAt: true,
      },
    });

    const match = describeMatch(d.similarity);
    return {
      id: d.id,
      status: d.alertStatus as FindingStatus,
      source: {
        url: d.url,
        platform: d.platform ?? d.sourcePlatform ?? null,
        pageTitle: d.pageTitle,
        firstSeen: d.firstSeen.toISOString(),
        lastSeen: d.lastSeen.toISOString(),
      },
      detection: {
        similarity: d.similarity,
        confidence: d.confidence,
        severity: d.severity,
        riskScore: d.riskScore,
        tampered: d.tampered,
        tampering: d.tampering,
        matchBand: match.band,
        matchLabel: match.label,
        matchMeaning: match.meaning,
        detectedAt: d.createdAt.toISOString(),
      },
      asset: asset
        ? {
            id: asset.id,
            filename: asset.originalFilename,
            assetType: asset.assetType,
            protectedAt: asset.createdAt.toISOString(),
            /** Facts, not fingerprints — the DNA value itself is never sent. */
            hasDna: Boolean(asset.dnaId),
            hasVault: Boolean(asset.vaultId),
            hasCertificate: Boolean(asset.certificateId),
          }
        : null,
      campaignId: scoped.asset.campaign!.id,
      investigationId: d.investigationId,
      evidenceId: d.evidenceId,
    };
  },
};
