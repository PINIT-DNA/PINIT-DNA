/**
 * Campaign-level view of Pinit's existing monitoring.
 *
 * This adds no monitoring engine, no crawler, no DNA comparison and no second
 * finding store. MonitorRecord, MonitoringRun, CrawlResult and AssetDiscovery
 * already exist and already work; monitoringService already enrols, scans and
 * classifies. All this does is scope those to a campaign, apply the business
 * RBAC, and report honestly what discovery is actually possible right now.
 *
 * The honesty part matters more than the rest. A monitoring screen that looks
 * alive while nothing is scanning is worse than one that says so, because
 * someone will believe their work is being watched when it is not.
 */
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import {
  monitoringService, isMonitoringCrawlerEnabled, MATCH,
} from '../crawler/monitoring.service';
import { BingVisualSearchProvider } from '../crawler/providers/bing-visual-search.provider';
import { FilenameSearchProvider } from '../crawler/providers/filename-search.provider';

/**
 * What discovery can actually do in this environment.
 *
 * Reported per provider rather than as one boolean, because "reverse image
 * search is unavailable" and "nothing works at all" are different situations
 * and the second is not true here.
 */
export interface DiscoveryCapability {
  /** False when the background crawler is switched off for this environment. */
  crawlerEnabled: boolean;
  /** True only when at least one provider can actually search. */
  anyProviderConfigured: boolean;
  /** True when image-content search is possible — the meaningful kind. */
  reverseImageAvailable: boolean;
  providers: Array<{
    id: string;
    label: string;
    configured: boolean;
    /** What it can find, so the gap is understandable rather than just "off". */
    finds: string;
    /** What would make it work, when it does not. */
    requires: string | null;
  }>;
  /** One sentence the UI can show without composing its own. */
  summary: string;
}

export function getDiscoveryCapability(): DiscoveryCapability {
  const bing = new BingVisualSearchProvider();
  const filename = new FilenameSearchProvider();

  const reverseImageAvailable = bing.isConfigured();
  const crawlerEnabled = isMonitoringCrawlerEnabled();

  const providers = [
    {
      id: 'bing-visual',
      label: 'Reverse image search',
      configured: reverseImageAvailable,
      finds: 'Copies and edits of the image itself, anywhere it has been published.',
      requires: reverseImageAvailable ? null : 'A Bing Visual Search API key (BING_SEARCH_API_KEY).',
    },
    {
      id: 'filename',
      label: 'Filename search',
      configured: filename.isConfigured(),
      finds: 'Pages that reference the file by name. Weak — it cannot see the image.',
      requires: null,
    },
  ];

  const anyProviderConfigured = providers.some((p) => p.configured);

  const summary = !crawlerEnabled
    ? 'Background scanning is turned off in this environment, so no new findings will appear.'
    : !reverseImageAvailable
      ? 'Reverse image search is not configured, so copies of the image itself cannot be found. '
        + 'Only filename references will be discovered.'
      : 'Monitoring is active and searching for copies of your work.';

  return { crawlerEnabled, anyProviderConfigured, reverseImageAvailable, providers, summary };
}

/** Load a campaign and prove it belongs to this organization. */
async function loadCampaignScoped(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { id: true, name: true },
  });
  if (!campaign) throw new AppError(404, 'Campaign not found');
  return campaign;
}

export const campaignMonitoringService = {
  /**
   * Monitoring status for every asset in a campaign.
   *
   * Findings come from AssetDiscovery and CrawlResult, both of which already
   * exist. Nothing here fabricates a count: an asset with no scans reports zero
   * and says it has never been scanned, rather than showing a hopeful dash.
   */
  async listForCampaign(organizationId: string, actorUserId: string, campaignId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const campaign = await loadCampaignScoped(organizationId, campaignId);

    const assets = await prisma.asset.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, originalFilename: true, assetType: true,
        dnaId: true, vaultId: true, monitorStatus: true, monitorRecordId: true,
        lastScanAt: true, lastDiscoveryAt: true, discoveriesCount: true,
        riskScore: true, riskSeverity: true,
      },
    });

    if (assets.length === 0) {
      return {
        campaignName: campaign.name,
        capability: getDiscoveryCapability(),
        assets: [],
        totals: { monitored: 0, findings: 0, needsReview: 0, confirmed: 0 },
      };
    }

    const assetIds = assets.map((a) => a.id);
    const dnaIds = assets.map((a) => a.dnaId).filter((d): d is string => Boolean(d));

    const [monitors, discoveries, runs] = await Promise.all([
      // Monitors are keyed by DNA record, which is how the existing engine works.
      dnaIds.length
        ? prisma.monitorRecord.findMany({
            where: { dnaRecordId: { in: dnaIds } },
            select: {
              id: true, dnaRecordId: true, status: true, scanType: true,
              lastCheckedAt: true, nextCheckAt: true, totalChecks: true,
              totalMatches: true, totalFailures: true, checkEveryHrs: true,
            },
          })
        : Promise.resolve([]),
      prisma.assetDiscovery.findMany({
        where: { assetId: { in: assetIds } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, assetId: true, url: true, platform: true, similarity: true,
          confidence: true, severity: true, alertStatus: true, createdAt: true,
          firstSeen: true, lastSeen: true,
        },
      }),
      prisma.monitoringRun.findMany({
        where: { monitorRecord: { dnaRecordId: { in: dnaIds } } },
        orderBy: { startedAt: 'desc' },
        take: 50,
        select: {
          id: true, monitorRecordId: true, status: true, trigger: true,
          startedAt: true, completedAt: true, durationMs: true,
          candidatesFound: true, matchesFound: true, failureReason: true,
        },
      }),
    ]);

    const monitorByDna = new Map(monitors.map((m) => [m.dnaRecordId, m]));
    const runsByMonitor = new Map<string, typeof runs>();
    for (const r of runs) {
      const list = runsByMonitor.get(r.monitorRecordId) ?? [];
      list.push(r);
      runsByMonitor.set(r.monitorRecordId, list);
    }
    const discByAsset = new Map<string, typeof discoveries>();
    for (const d of discoveries) {
      const list = discByAsset.get(d.assetId) ?? [];
      list.push(d);
      discByAsset.set(d.assetId, list);
    }

    const shaped = assets.map((a) => {
      const monitor = a.dnaId ? monitorByDna.get(a.dnaId) : undefined;
      const found = discByAsset.get(a.id) ?? [];
      const history = monitor ? (runsByMonitor.get(monitor.id) ?? []) : [];

      return {
        assetId: a.id,
        filename: a.originalFilename,
        assetType: a.assetType,
        /** Monitoring needs a DNA record — without one there is nothing to match against. */
        canMonitor: Boolean(a.dnaId),
        monitoring: monitor
          ? {
              enabled: monitor.status === 'ACTIVE',
              status: monitor.status,
              scanType: monitor.scanType,
              everyHours: monitor.checkEveryHrs,
              lastScanAt: monitor.lastCheckedAt ? monitor.lastCheckedAt.toISOString() : null,
              nextScanAt: monitor.nextCheckAt ? monitor.nextCheckAt.toISOString() : null,
              totalScans: monitor.totalChecks,
              totalMatches: monitor.totalMatches,
              totalFailures: monitor.totalFailures,
            }
          : null,
        findings: {
          total: found.length,
          needsReview: found.filter((d) => d.alertStatus === 'PENDING').length,
          confirmed: found.filter((d) => d.alertStatus === 'CONFIRMED').length,
          dismissed: found.filter((d) => d.alertStatus === 'DISMISSED').length,
          lastAt: found[0]?.createdAt.toISOString() ?? null,
        },
        recentScans: history.slice(0, 5).map((r) => ({
          id: r.id,
          status: r.status,
          trigger: r.trigger,
          startedAt: r.startedAt.toISOString(),
          completedAt: r.completedAt ? r.completedAt.toISOString() : null,
          durationMs: r.durationMs,
          candidatesFound: r.candidatesFound,
          matchesFound: r.matchesFound,
          failureReason: r.failureReason,
        })),
      };
    });

    return {
      campaignName: campaign.name,
      capability: getDiscoveryCapability(),
      assets: shaped,
      totals: {
        monitored: shaped.filter((a) => a.monitoring?.enabled).length,
        findings: shaped.reduce((n, a) => n + a.findings.total, 0),
        needsReview: shaped.reduce((n, a) => n + a.findings.needsReview, 0),
        confirmed: shaped.reduce((n, a) => n + a.findings.confirmed, 0),
      },
    };
  },

  /**
   * Turn monitoring on for one campaign asset.
   *
   * Delegates to the existing monitoringService.enroll, which owns enrolment,
   * scheduling and the DNA linkage. Enrolment is allowed even when the crawler
   * is off — the record is real and will be scanned once scanning is available.
   * The UI says so rather than pretending a scan is imminent.
   */
  async enable(
    organizationId: string,
    actorUserId: string,
    campaignId: string,
    assetId: string,
    opts: { scanType?: string } = {},
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    await loadCampaignScoped(organizationId, campaignId);

    const asset = await prisma.asset.findFirst({
      where: { id: assetId, campaignId },
      select: { id: true, dnaId: true, originalFilename: true, ownerUserId: true },
    });
    if (!asset) throw new AppError(404, 'That asset is not part of this campaign');
    if (!asset.dnaId) {
      throw new AppError(
        400,
        'This file has no DNA record yet, so there is nothing to match against. Protect it first.',
      );
    }

    const monitorRecordId = await monitoringService.enroll(asset.dnaId, {
      ownerUserId: asset.ownerUserId,
      scanType: opts.scanType ?? 'CONTINUOUS',
    });

    await prisma.asset.update({
      where: { id: assetId },
      data: { monitorRecordId, monitorStatus: 'PENDING' },
    });

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'MONITORING_ENABLED',
      entityType: 'campaign', entityId: campaignId,
      title: `Monitoring enabled for ${asset.originalFilename}`,
      detail: { assetId, monitorRecordId },
    });

    return { monitorRecordId, capability: getDiscoveryCapability() };
  },

  /**
   * Stop monitoring an asset.
   *
   * Sets the existing STOPPED status rather than deleting the record, so scan
   * history and any findings already made survive — a finding does not become
   * untrue because watching stopped.
   */
  async disable(organizationId: string, actorUserId: string, campaignId: string, assetId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MEMBER);
    await loadCampaignScoped(organizationId, campaignId);

    const asset = await prisma.asset.findFirst({
      where: { id: assetId, campaignId },
      select: { id: true, dnaId: true, originalFilename: true },
    });
    if (!asset?.dnaId) throw new AppError(404, 'That asset is not part of this campaign');

    const { count } = await prisma.monitorRecord.updateMany({
      where: { dnaRecordId: asset.dnaId, status: { not: 'STOPPED' } },
      data: { status: 'STOPPED', nextCheckAt: null },
    });

    await prisma.asset.update({
      where: { id: assetId },
      data: { monitorStatus: 'DISABLED' },
    });

    await logOrgAudit({
      organizationId, actorUserId,
      action: 'MONITORING_DISABLED',
      entityType: 'campaign', entityId: campaignId,
      title: `Monitoring stopped for ${asset.originalFilename}`,
      detail: { assetId },
    });

    return { stopped: count };
  },

  /** Match thresholds, so the UI can explain a score rather than just print it. */
  matchBands() {
    return [
      { id: MATCH.EXACT, label: 'Exact match', from: 0.95 },
      { id: MATCH.HIGH, label: 'Close match', from: 0.85 },
      { id: MATCH.POSSIBLE, label: 'Possible match', from: 0.70 },
    ];
  },
};
