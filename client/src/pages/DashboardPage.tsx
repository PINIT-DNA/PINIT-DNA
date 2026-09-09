import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle, RefreshCw, Store,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useApi } from '../hooks/useApi';
import {
  getDashboardStats, api, listVaultRecords, getLiveTrackingMap,
  getDashboardSecurityInsights, type DashboardSecurityInsights,
  getExchangeSellerSummary, getExchangeBuyerSummary, createExchangeSso,
  getMonitoringStatus, type MonitoringStatus,
  type ExchangeBuyerSummary,
} from '../services/dashboard.api';
import type { VaultRecord } from '../types/dashboard.types';
import type { DashboardFileMapPoint } from '../components/maps/DashboardFilesMap';
import {
  FORENSIC_REPORTS_UPDATED_EVENT, listForensicReports,
  type StoredForensicReport,
} from '../lib/forensic-reports-storage';
import { toUserPinitId } from '../lib/pinit-identity';
import { API_BASE_URL } from '../config/api.config';
import { useAuth } from '../context/AuthContext';
import { isRealDisplayName, useUserProfile } from '../hooks/useUserProfile';
import { UpgradeWelcomeModal } from '../components/subscription/UpgradeWelcomeModal';
import {
  consumePendingUpgradeWelcome,
  markUpgradeWelcomeSeen,
} from '../lib/subscription/upgrade-welcome';
import type { PlanCode } from '../hooks/useSubscription';
import { CreatorHomeView, type HomePortfolioGroup } from './home/CreatorHomeView';
import {
  friendlyMatchLabel, resolveHomeActivityHref,
  type HomeActivityEvent,
} from '../lib/home-activity';

interface ShareStats {
  totalViews: number; uniqueRecipients: number; countriesReached: number;
  citiesReached: number; avgViewTimeSec: number; downloads: number;
  blockedDownloads: number; printAttempts: number; copyAttempts: number;
  screenshotAttempts: number;
  riskDistribution: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
  pageCompletion: null; forwardChains: null; leakIncidents: null; leakSources: null;
}

export function DashboardPage() {
  const { user } = useAuth();
  const { firstName, displayName, profile } = useUserProfile();
  const { data: stats, loading, error, refetch } = useApi(getDashboardStats, [], { cacheKey: 'dashboard-stats' });
  const [shareStats, setShareStats] = useState<ShareStats | null>(null);
  const [shareLinks, setShareLinks] = useState<Array<{
    token: string;
    vaultId?: string | null;
    filename: string;
    isActive?: boolean;
    createdAt?: string;
    expiresAt?: string | null;
    accessLogs?: Array<{
      id: string;
      action: string;
      createdAt: string;
    }>;
  }>>([]);
  const [vaultRecords, setVaultRecords] = useState<VaultRecord[]>([]);
  const [trackingPoints, setTrackingPoints] = useState<DashboardFileMapPoint[]>([]);
  const [trackingMeta, setTrackingMeta] = useState({ recent: 0, total: 0 });
  const [securityInsights, setSecurityInsights] = useState<DashboardSecurityInsights | null>(null);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [exchangeSelling, setExchangeSelling] = useState<{
    can_list: boolean;
    unavailable?: boolean;
    metrics: {
      total_net_revenue: number;
      sealed_sales_count: number;
      active_listings_count: number;
      listings_count: number;
      total_views: number;
      total_saves: number;
    };
  } | null>(null);
  const [exchangeBuying, setExchangeBuying] = useState<ExchangeBuyerSummary | null>(null);
  const [monitoringStatus, setMonitoringStatus] = useState<MonitoringStatus | null>(null);
  const [reports, setReports] = useState<StoredForensicReport[]>([]);
  const [welcomePlan, setWelcomePlan] = useState<PlanCode | null>(null);
  const [portfolioGroups, setPortfolioGroups] = useState<HomePortfolioGroup[]>([]);
  const [portfolioHeadline, setPortfolioHeadline] = useState('');
  const [portfolioAbout, setPortfolioAbout] = useState('');
  const [portfolioLocation, setPortfolioLocation] = useState('');
  const [profileEvents, setProfileEvents] = useState<HomeActivityEvent[]>([]);
  const [activityFilter, setActivityFilter] = useState('all');
  const [activityQuery, setActivityQuery] = useState('');

  useEffect(() => {
    if (!user?.sub) return;
    const pending = consumePendingUpgradeWelcome(user.sub);
    if (pending && pending !== 'FREE') {
      setWelcomePlan(pending);
    }
  }, [user?.sub]);

  useEffect(() => {
    if (stats?.vaultRecords) {
      setVaultRecords(stats.vaultRecords);
      return;
    }
    listVaultRecords()
      .then(setVaultRecords)
      .catch(() => setVaultRecords([]));
  }, [stats?.totalVaultRecords, stats?.vaultRecords]);

  useEffect(() => {
    const fetchTracking = () => {
      getLiveTrackingMap()
        .then((data) => {
          setTrackingPoints(data.points);
          setTrackingMeta({ recent: data.recentAccessCount, total: data.totalAccessPoints });
        })
        .catch(() => {});
    };
    fetchTracking();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchTracking();
    }, 90_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const loadSecurity = () => {
      getDashboardSecurityInsights()
        .then(setSecurityInsights)
        .catch(() => setSecurityInsights(null))
        .finally(() => setSecurityLoading(false));
    };
    loadSecurity();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      loadSecurity();
    }, 90_000);
    return () => clearInterval(id);
  }, []);

  const fetchShare = () => {
    api.get(`${API_BASE_URL}/share/analytics/global`)
      .then(({ data }) => setShareStats((data as { stats?: ShareStats }).stats ?? null))
      .catch(() => {});
    api.get(`${API_BASE_URL}/share`)
      .then(({ data }) => {
        const links = (data as { links?: typeof shareLinks }).links ?? [];
        setShareLinks(links);
      })
      .catch(() => {});
  };

  const fetchPortfolio = () => {
    api.get(`${API_BASE_URL}/portfolio/me`)
      .then(({ data }) => {
        const payload = data as {
          portfolio?: Record<string, unknown>;
          headline?: string;
          about?: string;
          location?: string;
          project_groups?: unknown;
          projects?: unknown;
          identity?: { headline?: string; about?: string; location?: string };
        };
        const p = (payload.portfolio && typeof payload.portfolio === 'object')
          ? payload.portfolio as Record<string, unknown>
          : payload;
        const rawGroups = Array.isArray(p.project_groups)
          ? p.project_groups
          : Array.isArray(p.projects)
            ? p.projects
            : [];
        const groups: HomePortfolioGroup[] = rawGroups.map((g: Record<string, unknown>, i: number) => ({
          id: String(g.id ?? i),
          title: String(g.title || g.name || 'Collection'),
          category: String(g.category || g.type || ''),
          vault_ids: Array.isArray(g.vault_ids) ? g.vault_ids.map(String) : [],
        }));
        setPortfolioGroups(groups);
        setPortfolioHeadline(String(p.headline || payload.identity?.headline || payload.headline || ''));
        setPortfolioAbout(String(p.about || payload.identity?.about || payload.about || ''));
        setPortfolioLocation(String(p.location || payload.identity?.location || payload.location || ''));
      })
      .catch(() => {
        setPortfolioGroups([]);
      });
  };

  const fetchProfileActivity = () => {
    api.get(`${API_BASE_URL}/profile/activity?limit=30`)
      .then(({ data }) => {
        const events = ((data as { events?: Array<{ id?: string; type?: string; date?: string; detail?: string }> }).events ?? [])
          .map((ev, i) => ({
            id: String(ev.id ?? `ev-${i}`),
            type: String(ev.type ?? ''),
            date: typeof ev.date === 'string' ? ev.date : new Date(ev.date as unknown as string).toISOString(),
            detail: String(ev.detail ?? ''),
          }));
        setProfileEvents(events);
      })
      .catch(() => setProfileEvents([]));
  };

  const fetchMonitoringStatus = () => {
    getMonitoringStatus().then(setMonitoringStatus).catch(() => setMonitoringStatus(null));
  };

  const fetchExchangeBuying = () => {
    getExchangeBuyerSummary()
      .then(setExchangeBuying)
      .catch(() => setExchangeBuying(null));
  };

  const fetchExchangeSelling = () => {
    getExchangeSellerSummary()
      .then((data) => setExchangeSelling({
        can_list: data.can_list,
        unavailable: data.unavailable,
        metrics: data.metrics,
      }))
      .catch(() => setExchangeSelling(null));
  };

  const openExchangeSeller = async () => {
    try {
      const result = await createExchangeSso();
      const url = new URL(result.exchangeUrl);
      url.pathname = '/exchange/seller';
      window.open(url.toString(), 'pinit-exchange', 'noopener,noreferrer');
    } catch {
      /* Hub SSO failed — Home still works */
    }
  };

  const handleRefresh = () => {
    refetch();
    setSecurityLoading(true);
    getDashboardSecurityInsights()
      .then(setSecurityInsights)
      .finally(() => setSecurityLoading(false));
    fetchShare();
    fetchExchangeSelling();
    fetchExchangeBuying();
    fetchMonitoringStatus();
    fetchPortfolio();
    fetchProfileActivity();
    listVaultRecords()
      .then(setVaultRecords)
      .catch(() => setVaultRecords([]));
    getLiveTrackingMap()
      .then((data) => {
        setTrackingPoints(data.points);
        setTrackingMeta({ recent: data.recentAccessCount, total: data.totalAccessPoints });
      })
      .catch(() => {});
  };

  useEffect(() => {
    const readReports = () => {
      try { setReports(listForensicReports().slice(0, 4)); } catch { setReports([]); }
    };
    readReports();
    const onReportsUpdated = () => { refetch(); readReports(); };
    window.addEventListener(FORENSIC_REPORTS_UPDATED_EVENT, onReportsUpdated);
    return () => window.removeEventListener(FORENSIC_REPORTS_UPDATED_EVENT, onReportsUpdated);
  }, [refetch]);

  useEffect(() => {
    fetchShare();
    fetchExchangeSelling();
    fetchExchangeBuying();
    fetchMonitoringStatus();
    fetchPortfolio();
    fetchProfileActivity();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchShare();
      fetchExchangeSelling();
      fetchExchangeBuying();
      fetchMonitoringStatus();
    }, 90_000);
    return () => clearInterval(id);
  }, []);

  const attentionFeed = useMemo(() => {
    const now = Date.now();
    const soon = now + 72 * 60 * 60 * 1000;
    const items: Array<{
      key: string;
      tone: 'warn' | 'info';
      title: string;
      strong: string;
      detail: string;
      to: string;
      action: string;
    }> = [];

    for (const link of shareLinks) {
      if (!link.isActive || !link.expiresAt) continue;
      const exp = new Date(link.expiresAt).getTime();
      if (Number.isNaN(exp) || exp > soon || exp < now) continue;
      const opens = link.accessLogs?.length ?? 0;
      items.push({
        key: `share-${link.token}`,
        tone: 'info',
        title: 'Your share of',
        strong: link.filename,
        detail: `Expires ${formatDistanceToNow(new Date(exp), { addSuffix: true })}`
          + (opens ? ` · opened ${opens} ${opens === 1 ? 'time' : 'times'}` : ' · not opened yet'),
        to: `/access-intelligence/${link.token}`,
        action: 'Review link',
      });
    }

    for (const p of exchangeBuying?.purchases ?? []) {
      if (!p.license_expires_at) continue;
      const exp = Date.parse(p.license_expires_at);
      if (Number.isNaN(exp) || exp > soon || exp < now) continue;
      items.push({
        key: `licence-${p.seal_id}`,
        tone: 'warn',
        title: 'Your licence for',
        strong: p.title,
        detail: `${p.license_tier} licence · expires ${formatDistanceToNow(new Date(exp), { addSuffix: true })}`,
        to: '/certificates',
        action: 'View licence',
      });
    }

    const dupes = securityInsights?.duplicateAttempts;
    for (const item of (dupes?.items ?? []).slice(0, 2)) {
      items.push({
        key: `dupe-${item.filename}-${item.ago}`,
        tone: 'warn',
        title: 'Someone else tried to protect',
        strong: item.filename,
        detail: `${friendlyMatchLabel(item.matchType)} · ${item.riskLevel.toLowerCase()} risk · ${item.ago}`,
        to: '/duplicate-attempts',
        action: 'Review attempt',
      });
    }
    const dupeRest = (dupes?.count ?? 0) - Math.min(2, dupes?.items.length ?? 0);
    if (dupeRest > 0) {
      items.push({
        key: 'dupe-rest',
        tone: 'warn',
        title: 'And',
        strong: `${dupeRest} more upload ${dupeRest === 1 ? 'attempt' : 'attempts'}`,
        detail: 'Other people tried to protect files matching work you own',
        to: '/duplicate-attempts',
        action: 'Review all',
      });
    }

    const crawler = securityInsights?.crawlerAlerts;
    for (const item of (crawler?.items ?? []).slice(0, 2)) {
      let where = item.url;
      try { where = new URL(item.url).hostname; } catch { /* keep the raw value */ }
      items.push({
        key: `match-${item.filename}-${item.url}`,
        tone: 'warn',
        title: 'Monitoring matched',
        strong: item.filename,
        detail: `${Math.round(item.similarity)}% similar · ${friendlyMatchLabel(item.matchType)} · found on ${where}`,
        to: '/monitoring',
        action: 'Investigate',
      });
    }

    const risky = (shareStats?.riskDistribution.HIGH ?? 0) + (shareStats?.riskDistribution.CRITICAL ?? 0);
    if (risky > 0) {
      items.push({
        key: 'risk',
        tone: 'warn',
        title: 'Security events on',
        strong: `${risky} ${risky === 1 ? 'viewer' : 'viewers'}`,
        detail: 'Rated high or critical risk while viewing a share',
        to: '/access-intelligence',
        action: 'See activity',
      });
    }

    return items.slice(0, 4);
  }, [shareLinks, exchangeBuying, securityInsights, shareStats]);

  const activitySnapshot = useMemo(() => {
    const views = shareStats?.totalViews ?? 0;
    const downloads = shareStats?.downloads ?? 0;
    const shares = shareLinks.length;
    const security = (shareStats?.blockedDownloads ?? 0)
      + (shareStats?.printAttempts ?? 0)
      + (shareStats?.copyAttempts ?? 0)
      + (shareStats?.screenshotAttempts ?? 0);
    return { views, downloads, shares, security };
  }, [shareStats, shareLinks]);

  const homeActivity = useMemo(() => {
    const extra: HomeActivityEvent[] = [];
    for (const report of reports) {
      extra.push({
        id: `evd-${report.id}`,
        type: 'EVIDENCE_CREATED',
        date: report.savedAt,
        detail: report.kind === 'investigation' ? report.filename : 'Comparison',
      });
    }
    for (const item of securityInsights?.crawlerAlerts.items ?? []) {
      extra.push({
        id: `mon-${item.filename}-${item.url}`,
        type: 'MONITORING_MATCH',
        date: new Date().toISOString(),
        detail: item.filename,
      });
    }
    return [...profileEvents, ...extra]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map((ev) => ({
        ...ev,
        href: resolveHomeActivityHref(ev, { vaultRecords, shareLinks }),
      }));
  }, [profileEvents, reports, securityInsights, vaultRecords, shareLinks]);

  const portfolioItemCount = useMemo(() => {
    const ids = new Set<string>();
    for (const g of portfolioGroups) {
      for (const id of g.vault_ids) ids.add(id);
    }
    return ids.size;
  }, [portfolioGroups]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-danger mx-auto mb-3" />
          <p className="text-gray-400 text-sm">{error}</p>
          <button onClick={refetch} className="btn btn-secondary btn-sm mt-3">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      </div>
    );
  }

  const welcomeName = isRealDisplayName(displayName)
    ? firstName
    : (toUserPinitId(user?.shortId) || user?.shortId?.trim() || null);

  const geoLine = shareStats && (shareStats.countriesReached > 0 || shareStats.citiesReached > 0)
    ? `${shareStats.countriesReached} ${shareStats.countriesReached === 1 ? 'country' : 'countries'} · ${shareStats.citiesReached} ${shareStats.citiesReached === 1 ? 'city' : 'cities'}`
    : null;

  const activeShareCount = securityInsights?.activeShares.count ?? shareLinks.filter((l) => l.isActive).length;

  return (
    <>
      <CreatorHomeView
        greetingName={welcomeName}
        profile={profile}
        protectedCount={stats?.totalVaultRecords ?? vaultRecords.length}
        projectCount={portfolioGroups.length}
        portfolioItemCount={portfolioItemCount}
        activeShareCount={activeShareCount}
        loadingStats={loading && !stats}
        onRefresh={handleRefresh}
        refreshing={loading}
        attention={attentionFeed}
        attentionLoading={securityLoading && !securityInsights}
        vaultRecords={vaultRecords}
        activity={homeActivity}
        activityFilter={activityFilter}
        onActivityFilter={setActivityFilter}
        activityQuery={activityQuery}
        onActivityQuery={setActivityQuery}
        portfolioGroups={portfolioGroups}
        portfolioHeadline={portfolioHeadline}
        portfolioAbout={portfolioAbout}
        portfolioLocation={portfolioLocation}
        monitoringEnabled={monitoringStatus == null ? null : monitoringStatus.monitoringEnabled}
        monitoringMatches={securityInsights?.crawlerAlerts.count ?? 0}
        evidenceCount={reports.length}
        suspiciousCount={activitySnapshot.security}
        trackingPoints={trackingPoints}
        trackingRecent={trackingMeta.recent}
        trackingTotal={trackingMeta.total}
        geoLine={geoLine}
        onOpenExchange={() => void openExchangeSeller()}
      >
        <section className="hub-home-block">
          <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
            <div>
              <h2 className="hub-home-section">Marketplace</h2>
              <p className="hub-home-meta mt-1">
                {exchangeSelling?.unavailable && exchangeBuying?.unavailable
                  ? 'No marketplace activity to show right now.'
                  : 'What you are selling and what you have licensed.'}
              </p>
            </div>
            <button type="button" className="btn btn-secondary btn-sm gap-2" onClick={() => void openExchangeSeller()}>
              <Store size={13} />
              Open Exchange
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 hub-home-body">
            <p>
              {!exchangeSelling || exchangeSelling.unavailable
                ? 'No listings or sales to show yet.'
                : `${exchangeSelling.metrics.active_listings_count} live listings`}
            </p>
            <p>
              {!exchangeBuying || exchangeBuying.unavailable
                ? 'No purchases or licences to show yet.'
                : `${exchangeBuying.metrics.purchases_count} purchases`}
            </p>
          </div>
        </section>
      </CreatorHomeView>

      {welcomePlan && user?.sub && (
        <UpgradeWelcomeModal
          open={Boolean(welcomePlan)}
          planCode={welcomePlan}
          onDismiss={() => {
            markUpgradeWelcomeSeen(user.sub, welcomePlan);
            setWelcomePlan(null);
          }}
        />
      )}
    </>
  );
}
