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
import { emitCampaignMonitoringChanged } from '../platform-events';
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
/**
 * Provider health.
 *
 * "Configured" and "working" are different questions and conflating them is how
 * a dead provider gets reported as available. NOT_CONFIGURED means it lacks its
 * credentials. OPERATIONAL means it has produced a real match. DEGRADED means it
 * runs but has produced nothing usable — which is the honest description of a
 * provider that has returned zero matches across thousands of runs.
 */
export type ProviderHealth = 'OPERATIONAL' | 'DEGRADED' | 'NOT_CONFIGURED' | 'UNKNOWN';

export interface ProviderStatus {
  id: string;
  label: string;
  /** Has its credentials / prerequisites. */
  configured: boolean;
  /** Whether it actually works, judged on evidence rather than config. */
  health: ProviderHealth;
  /** Plain-language health, so the UI does not have to compose one. */
  healthReason: string;
  /** What it can find, so the gap is understandable rather than just "off". */
  finds: string;
  /** What would make it work, when it does not. */
  requires: string | null;
}

export interface DiscoveryCapability {
  /** False when the background crawler is switched off for this environment. */
  crawlerEnabled: boolean;
  /** True only when at least one provider has its credentials. */
  anyProviderConfigured: boolean;
  /** True only when a provider has actually produced a match. */
  anyProviderOperational: boolean;
  /** True when image-content search is possible — the meaningful kind. */
  reverseImageAvailable: boolean;
  providers: ProviderStatus[];
  /** When any provider last returned a candidate to compare. Null if never. */
  lastCandidateAt: string | null;
  /** When comparison last produced a real match. Null if never. */
  lastMatchAt: string | null;
  /** Evidence behind the health verdicts. */
  evidence: { totalRuns: number; runsWithCandidates: number; totalMatches: number };
  /** One sentence the UI can show without composing its own. */
  summary: string;
}

/**
 * What discovery can actually do, judged on evidence rather than configuration.
 *
 * Reads real run history: whether candidates have ever been returned, and
 * whether comparison has ever produced a match. A provider that is configured
 * and runs but has never produced a match is DEGRADED, not available — calling
 * it available is how someone comes to believe their work is being watched.
 */
export async function getDiscoveryCapability(): Promise<DiscoveryCapability> {
  const bing = new BingVisualSearchProvider();
  const filename = new FilenameSearchProvider();

  const reverseImageAvailable = bing.isConfigured();
  const crawlerEnabled = isMonitoringCrawlerEnabled();

  const [totalRuns, runsWithCandidates, totalMatches, lastCandidateRun, lastMatchRun] =
    await Promise.all([
      prisma.monitoringRun.count(),
      prisma.monitoringRun.count({ where: { candidatesFound: { gt: 0 } } }),
      prisma.monitoringRun.count({ where: { matchesFound: { gt: 0 } } }),
      prisma.monitoringRun.findFirst({
        where: { candidatesFound: { gt: 0 } },
        orderBy: { startedAt: 'desc' }, select: { startedAt: true },
      }),
      prisma.monitoringRun.findFirst({
        where: { matchesFound: { gt: 0 } },
        orderBy: { startedAt: 'desc' }, select: { startedAt: true },
      }),
    ]);

  /**
   * A provider has produced nothing usable if scanning has run a meaningful
   * number of times and never yielded a match. Below that threshold the honest
   * answer is UNKNOWN — too early to judge, not "fine".
   */
  const ENOUGH_RUNS_TO_JUDGE = 25;
  const judge = (configured: boolean): { health: ProviderHealth; reason: string } => {
    if (!configured) {
      return { health: 'NOT_CONFIGURED', reason: 'Missing its credentials, so it never runs.' };
    }
    if (totalRuns < ENOUGH_RUNS_TO_JUDGE) {
      return { health: 'UNKNOWN', reason: 'Too few scans so far to say whether it works.' };
    }
    if (totalMatches > 0) {
      return { health: 'OPERATIONAL', reason: 'Has produced real matches.' };
    }
    return {
      health: 'DEGRADED',
      reason: `Runs, but has produced no usable discoveries in ${totalRuns.toLocaleString()} scans.`,
    };
  };

  const bingJudged = judge(reverseImageAvailable);
  const filenameJudged = judge(filename.isConfigured());

  const providers: ProviderStatus[] = [
    {
      id: 'bing-visual',
      label: 'Reverse image search',
      configured: reverseImageAvailable,
      health: bingJudged.health,
      healthReason: bingJudged.reason,
      finds: 'Copies and edits of the image itself, anywhere it has been published.',
      requires: reverseImageAvailable
        ? null
        : 'An image-search provider key. Note the Bing Search API this was built '
          + 'against was retired, so a replacement provider is likely needed.',
    },
    {
      id: 'filename',
      label: 'Filename search',
      configured: filename.isConfigured(),
      health: filenameJudged.health,
      healthReason: filenameJudged.reason,
      finds: 'Pages that reference the file by name. It cannot see the image itself.',
      requires: null,
    },
  ];

  const anyProviderConfigured = providers.some((p) => p.configured);
  const anyProviderOperational = providers.some((p) => p.health === 'OPERATIONAL');

  const summary = !crawlerEnabled
    ? 'Background scanning is turned off in this environment, so no new findings will appear.'
    : !anyProviderOperational
      ? 'No discovery provider is currently producing usable results, so copies of your work '
        + 'will not be found. Connecting a reverse-image provider is what changes this.'
      : !reverseImageAvailable
        ? 'Reverse image search is not connected, so copies of the image itself cannot be found.'
        : 'Monitoring is active and searching for copies of your work.';

  return {
    crawlerEnabled,
    anyProviderConfigured,
    anyProviderOperational,
    reverseImageAvailable,
    providers,
    lastCandidateAt: lastCandidateRun?.startedAt.toISOString() ?? null,
    lastMatchAt: lastMatchRun?.startedAt.toISOString() ?? null,
    evidence: { totalRuns, runsWithCandidates, totalMatches },
    summary,
  };
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
        capability: await getDiscoveryCapability(),
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
      capability: await getDiscoveryCapability(),
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

    await emitCampaignMonitoringChanged({
      campaignId, campaignName: '',
      assetName: asset.originalFilename,
      enabled: true, actorUserId,
    });

    return { monitorRecordId, capability: await getDiscoveryCapability() };
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

    await emitCampaignMonitoringChanged({
      campaignId, campaignName: '',
      assetName: asset.originalFilename,
      enabled: false, actorUserId,
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
