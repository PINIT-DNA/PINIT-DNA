import { Link } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import {
  Archive, Zap,
  AlertTriangle, RefreshCw,
  Eye, Globe, Plus, Link2, Radio, Download, Shield, FileText,
  Store, Search, Activity,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useApi, formatBytes } from '../hooks/useApi';
import {
  getDashboardStats, api, listVaultRecords, getLiveTrackingMap, deriveFileType,
  getDashboardSecurityInsights, type DashboardSecurityInsights,
  getExchangeSellerSummary, getExchangeBuyerSummary, createExchangeSso,
  getMonitoringStatus, type MonitoringStatus,
  type ExchangeBuyerSummary,
} from '../services/dashboard.api';
import type { VaultRecord } from '../types/dashboard.types';
import { DashboardFilesMap, type DashboardFileMapPoint } from '../components/maps/DashboardFilesMap';
import { VaultFileThumbnail } from '../components/VaultFileThumbnail';
import { Badge, FileTypeBadge, ClassificationBadge } from '../components/ui/Badge';
import {
  FORENSIC_REPORTS_UPDATED_EVENT, listForensicReports,
  type StoredForensicReport,
} from '../lib/forensic-reports-storage';
import { toUserPinitId } from '../lib/pinit-identity';
import { API_BASE_URL } from '../config/api.config';
import { useAuth } from '../context/AuthContext';
import { isRealDisplayName, useUserProfile } from '../hooks/useUserProfile';
import { UpgradeWelcomeModal } from '../components/subscription/UpgradeWelcomeModal';
import { OPEN_NOTIFICATION_BELL_EVENT } from '../lib/notification-config';
import {
  consumePendingUpgradeWelcome,
  markUpgradeWelcomeSeen,
} from '../lib/subscription/upgrade-welcome';
import type { PlanCode } from '../hooks/useSubscription';

interface ShareStats {
  totalViews: number; uniqueRecipients: number; countriesReached: number;
  citiesReached: number; avgViewTimeSec: number; downloads: number;
  blockedDownloads: number; printAttempts: number; copyAttempts: number;
  screenshotAttempts: number;
  riskDistribution: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
  pageCompletion: null; forwardChains: null; leakIncidents: null; leakSources: null;
}




function openNotificationBell() {
  window.dispatchEvent(new Event(OPEN_NOTIFICATION_BELL_EVENT));
}

function formatInr(amount: number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: Math.abs(n % 1) > 0.005 ? 2 : 0,
  }).format(n);
}

export function DashboardPage() {
  const { user } = useAuth();
  const { firstName, displayName } = useUserProfile();
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
  // The other half of the marketplace: what this person has licensed. Selling
  // and buying sit together at the top of Home so neither requires a trip into
  // Exchange to check on.
  const [exchangeBuying, setExchangeBuying] = useState<ExchangeBuyerSummary | null>(null);
  const [monitoringStatus, setMonitoringStatus] = useState<MonitoringStatus | null>(null);
  const [reports, setReports] = useState<StoredForensicReport[]>([]);
  const [welcomePlan, setWelcomePlan] = useState<PlanCode | null>(null);

  const vaultByDnaId = useMemo(
    () => new Map(vaultRecords.map((v) => [v.dnaRecordId, v])),
    [vaultRecords],
  );

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
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchShare();
      fetchExchangeSelling();
    fetchExchangeBuying();
    fetchMonitoringStatus();
    }, 90_000);
    return () => clearInterval(id);
  }, []);

  /**
   * Home's attention list, as events rather than counts.
   *
   * A number tells you something happened; it does not tell you to which asset,
   * or what to do about it. Each row here names the thing, says what happened,
   * and carries the action inline, so the page can be acted on without first
   * being decoded. Exchange licences are folded in for the same reason: a
   * licence lapsing is the buyer's problem whether or not they are in Exchange.
   */
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

    // Someone else trying to protect work this person already owns is the
    // sharpest signal Hub produces, so it names the file rather than counting.
    const dupes = securityInsights?.duplicateAttempts;
    for (const item of (dupes?.items ?? []).slice(0, 2)) {
      items.push({
        key: `dupe-${item.filename}-${item.ago}`,
        tone: 'warn',
        title: 'Someone else tried to protect',
        strong: item.filename,
        detail: `${item.matchType} match · ${item.riskLevel} risk · ${item.ago}`,
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
        detail: `${Math.round(item.similarity)}% similar · ${item.matchType} · found on ${where}`,
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

    return items.slice(0, 5);
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

  return (
    <div className="page-shell space-y-6 animate-fade-in">

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 mb-1">Home</p>
          <h1 className="text-xl sm:text-2xl font-bold text-gradient tracking-tight">
            {welcomeName ? `Hi ${welcomeName}` : 'Your account at a glance'}
          </h1>
          {/*
            * These were four stat cards. They are context, not decisions — the
            * page's job is to surface what needs acting on, and a storage figure
            * never does. As a line they still answer "how much have I got" while
            * leaving the cards above for things that can actually be acted on.
            */}
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            {loading || !stats ? (
              'Your assets are protected and under control.'
            ) : (
              <>
                <span className="text-gray-300 font-medium">{stats.totalVaultRecords}</span>
                {stats.totalVaultRecords === 1 ? ' asset' : ' assets'} protected
                <span className="text-gray-700 mx-2">·</span>
                <span className="text-gray-300 font-medium">{formatBytes(stats.totalEncryptedBytes)}</span>
                <span className="text-gray-700 mx-2">·</span>
                <span className="text-gray-300 font-medium">
                  {securityInsights?.activeShares.count ?? shareLinks.filter((l) => l.isActive).length}
                </span>
                {' active shares'}
                {geoLine ? (
                  <>
                    <span className="text-gray-700 mx-2">·</span>
                    <span className="text-gray-300 font-medium">{trackingMeta.total}</span>
                    {' access points across '}{geoLine}
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link to="/generate" className="btn btn-primary btn-sm gap-2">
            <Plus size={14} />
            Protect New
          </Link>
          <button onClick={handleRefresh} disabled={loading} className="btn btn-secondary btn-sm gap-2" title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-bg-border bg-bg-card px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Needs your attention</h2>
            {securityLoading && !securityInsights ? (
              <div className="skeleton h-4 w-40 mt-2 rounded" />
            ) : attentionFeed.length === 0 ? (
              <p className="text-sm text-gray-400 mt-1">
                Nothing to act on. No expiring shares, no monitoring matches, no security events.
              </p>
            ) : (
              <p className="text-sm text-gray-400 mt-1">
                {attentionFeed.length} {attentionFeed.length === 1 ? 'thing' : 'things'} today.
                Everything else is quiet.
              </p>
            )}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={openNotificationBell}>
            Review notifications
          </button>
        </div>

        {attentionFeed.length > 0 && (
          <div className="mt-3 divide-y divide-bg-border">
            {attentionFeed.map((item) => (
              <div key={item.key} className="flex flex-wrap items-center gap-3 py-3">
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    item.tone === 'warn'
                      ? 'bg-warning/10 text-warning'
                      : 'bg-dna-500/10 text-dna-400'
                  }`}
                >
                  {item.tone === 'warn' ? <AlertTriangle size={15} /> : <Link2 size={15} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-300">
                    {item.title} <span className="font-semibold text-white">{item.strong}</span>
                  </p>
                  <p className="text-2xs text-gray-500 mt-0.5">{item.detail}</p>
                </div>
                <Link to={item.to} className="btn btn-secondary btn-sm shrink-0">
                  {item.action}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/*
        * Marketplace, both directions.
        *
        * Selling was already here; buying was not, which meant a licence about
        * to lapse was only discoverable inside Exchange. A person who both
        * creates and licenses should see both sides of their market in one
        * place, near the top, without leaving Hub.
        */}
      <section className="rounded-xl border border-bg-border bg-bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Marketplace</h2>
            <p className="text-2xs text-gray-500 mt-0.5">
              {exchangeSelling?.unavailable && exchangeBuying?.unavailable
                ? 'Marketplace numbers will appear when Exchange is reachable.'
                : 'What you are selling and what you have licensed. Protection stays in Hub.'}
            </p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm gap-2" onClick={() => void openExchangeSeller()}>
            <Store size={13} />
            Open Exchange
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* ── selling ──────────────────────────────────────────── */}
          <div className="rounded-lg border border-bg-border bg-bg-elevated p-4">
            <p className="text-2xs font-semibold tracking-wider text-gray-500 uppercase mb-3">Selling</p>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div>
                <p className="text-xl font-bold text-white tabular-nums">
                  {formatInr(exchangeSelling?.metrics.total_net_revenue ?? 0)}
                </p>
                <p className="text-2xs text-gray-500">Creator net</p>
              </div>
              <div>
                <p className="text-xl font-bold text-white tabular-nums">
                  {exchangeSelling?.metrics.active_listings_count ?? 0}
                </p>
                <p className="text-2xs text-gray-500">Live listings</p>
              </div>
              <div>
                <p className="text-xl font-bold text-white tabular-nums">
                  {exchangeSelling?.metrics.total_views ?? 0}
                </p>
                <p className="text-2xs text-gray-500">
                  Views · {exchangeSelling?.metrics.total_saves ?? 0} saves
                </p>
              </div>
            </div>
            {/* A zero that explains itself is worth more than a zero that does not. */}
            {(exchangeSelling?.metrics.sealed_sales_count ?? 0) === 0
              && (exchangeSelling?.metrics.total_views ?? 0) > 0 ? (
              <p className="text-2xs text-gray-400 mt-3 leading-relaxed">
                People are looking, but nobody has licensed yet — views without a sale usually points
                at the price or the licence terms.
              </p>
            ) : null}
          </div>

          {/* ── buying ───────────────────────────────────────────── */}
          <div className="rounded-lg border border-bg-border bg-bg-elevated p-4">
            <p className="text-2xs font-semibold tracking-wider text-gray-500 uppercase mb-3">Buying</p>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div>
                <p className="text-xl font-bold text-white tabular-nums">
                  {exchangeBuying?.metrics.purchases_count ?? 0}
                </p>
                <p className="text-2xs text-gray-500">Purchases</p>
              </div>
              <div>
                <p className="text-xl font-bold text-white tabular-nums">
                  {exchangeBuying?.metrics.active_licenses_count ?? 0}
                </p>
                <p className="text-2xs text-gray-500">Active licences</p>
              </div>
              <div>
                <p className="text-xl font-bold text-white tabular-nums">
                  {formatInr(exchangeBuying?.metrics.total_spent ?? 0)}
                </p>
                <p className="text-2xs text-gray-500">Spent</p>
              </div>
            </div>

            {(exchangeBuying?.purchases.length ?? 0) > 0 ? (
              <div className="mt-3 divide-y divide-bg-border">
                {exchangeBuying!.purchases.slice(0, 3).map((purchase) => (
                  <div key={purchase.seal_id} className="flex items-center gap-3 py-2">
                    <FileText size={13} className="text-gray-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white truncate">{purchase.title}</p>
                      <p className="text-2xs text-gray-500">
                        {purchase.license_tier} licence
                        {purchase.sealed_at
                          ? ` · ${formatDistanceToNow(new Date(purchase.sealed_at), { addSuffix: true })}`
                          : ''}
                      </p>
                    </div>
                    <Badge variant={purchase.license_status === 'active' ? 'success' : 'muted'}>
                      {purchase.license_status === 'active' ? 'Active' : purchase.license_status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-2xs text-gray-400 mt-3 leading-relaxed">
                Nothing licensed yet. Work you buy on Exchange appears here with its licence terms
                and expiry.
              </p>
            )}
          </div>

        </div>
      </section>


      <section className="card space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">Activity</h2>
            <p className="text-2xs text-gray-500 mt-0.5">Account-level snapshot — not a full event log</p>
          </div>
          <Link to="/access-intelligence" className="btn btn-secondary btn-sm">
            View activity
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { icon: <Eye size={13} />, label: 'Views', value: activitySnapshot.views },
            { icon: <Download size={13} />, label: 'Downloads', value: activitySnapshot.downloads },
            { icon: <Link2 size={13} />, label: 'Shares', value: activitySnapshot.shares },
            { icon: <Shield size={13} />, label: 'Suspicious', value: activitySnapshot.security },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-bg-border bg-bg-elevated px-3 py-2">
              <p className="text-2xs text-gray-500 flex items-center gap-1">{m.icon}{m.label}</p>
              <p className="text-lg font-bold text-white tabular-nums mt-0.5">{m.value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <div className="card flex flex-col h-auto lg:h-[360px]">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Globe size={14} className="text-dna-400" />
              <h2 className="text-sm font-semibold text-white">Where assets were opened</h2>
              {trackingMeta.recent > 0 && (
                <Badge variant="success" dot>{trackingMeta.recent} in last hour</Badge>
              )}
              {trackingMeta.total > 0 && (
                <Badge variant="muted">{trackingMeta.total} locations</Badge>
              )}
            </div>
            <Link to="/access-intelligence" className="text-xs font-semibold text-dna-400 hover:text-dna-300">
              Open tracking
            </Link>
          </div>
          {geoLine && (
            <p className="text-2xs text-gray-500 mb-2 shrink-0">{geoLine}</p>
          )}
          <div className="relative flex-1 min-h-[220px] rounded-xl overflow-hidden border border-bg-border">
            <div className="absolute inset-0">
              <DashboardFilesMap points={trackingPoints} fill live />
            </div>
          </div>
        </div>

        <div className="card flex flex-col h-auto lg:h-[360px]">
          <div className="flex items-center justify-between mb-3 shrink-0">
            <h2 className="text-sm font-semibold text-white">Recently protected</h2>
            <Link to="/vault" className="text-xs text-dna-400 hover:text-dna-300">View all</Link>
          </div>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
          ) : stats && stats.recentActivity.length > 0 ? (
            <div className="space-y-2 overflow-y-auto min-h-0 flex-1 pr-0.5">
              {stats.recentActivity.slice(0, 4).map((r) => {
                const vaultId = r.vaultId ?? vaultByDnaId.get(r.id)?.id ?? null;
                const inner = (
                  <>
                    {vaultId ? (
                      <VaultFileThumbnail
                        vaultId={vaultId}
                        fileName={r.imageFilename}
                        mimeType={r.imageMimeType}
                        variant="compact"
                      />
                    ) : (
                      <FileTypeBadge type={deriveFileType(r)} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-white truncate">{r.imageFilename}</p>
                      <p className="text-2xs text-gray-500 mt-0.5">
                        {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <ClassificationBadge value={r.status} />
                  </>
                );
                const className = 'flex items-center gap-3 p-2 rounded-lg bg-bg-elevated border border-bg-border hover:border-dna-500/30 transition-all';
                return vaultId ? (
                  <Link key={r.id} to={`/vault?id=${encodeURIComponent(vaultId)}`} className={className}>
                    {inner}
                  </Link>
                ) : (
                  <div key={r.id} className={className}>{inner}</div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <FileText size={24} className="text-gray-500 mb-2" />
              <p className="text-sm text-gray-500">No protected files yet</p>
              <Link to="/generate" className="btn btn-primary btn-sm mt-4">Protect New</Link>
            </div>
          )}
        </div>
      </div>

      {shareStats && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">Security overview</h2>
              <p className="text-2xs text-gray-500 mt-0.5">
                Viewer risk and protection events. Screenshot tries are best-effort in a browser.
              </p>
            </div>
            <Link to="/access-intelligence" className="btn btn-secondary btn-sm">
              View security activity
            </Link>
          </div>
          {(shareStats.riskDistribution.LOW + shareStats.riskDistribution.MEDIUM + shareStats.riskDistribution.HIGH + shareStats.riskDistribution.CRITICAL) > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {([
                { key: 'LOW' as const, label: 'Low', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/25' },
                { key: 'MEDIUM' as const, label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/25' },
                { key: 'HIGH' as const, label: 'High', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/25' },
                { key: 'CRITICAL' as const, label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/25' },
              ]).map(({ key, label, color, bg }) => (
                <div key={key} className={`rounded-lg border px-2 py-2 text-center ${bg}`}>
                  <p className={`text-lg font-bold tabular-nums ${color}`}>{shareStats.riskDistribution[key]}</p>
                  <p className="text-2xs text-gray-500">{label}</p>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Blocked downloads', value: shareStats.blockedDownloads },
              { label: 'Print tries', value: shareStats.printAttempts },
              { label: 'Copy tries', value: shareStats.copyAttempts },
              { label: 'Screenshot tries', value: shareStats.screenshotAttempts },
            ].map((m) => (
              <div key={m.label} className="rounded-lg border border-bg-border bg-bg-elevated px-2 py-2">
                <p className="text-2xs text-gray-500">{m.label}</p>
                <p className="text-sm font-bold text-white tabular-nums mt-0.5">{m.value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/*
        * Investigation and monitoring were reachable from the sidebar but never
        * reported on. A paused crawler is not the same as one that found
        * nothing, and an investigation you ran yesterday should be one click
        * away rather than something you go looking for.
        */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        <div className="card flex flex-col">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Monitoring</h2>
              <p className="text-2xs text-gray-500 mt-0.5">
                Watching enrolled assets on authorised surfaces
              </p>
            </div>
            <Link to="/monitoring" className="btn btn-secondary btn-sm shrink-0">Open</Link>
          </div>

          <div className="flex items-center gap-2.5 mb-3">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                monitoringStatus?.monitoringEnabled ? 'bg-success' : 'bg-warning'
              }`}
            />
            <p className="text-sm text-white">
              {monitoringStatus === null
                ? 'Status unavailable'
                : monitoringStatus.monitoringEnabled
                  ? 'Active — crawler is running'
                  : 'Paused — configuration kept'}
            </p>
          </div>
          <p className="text-2xs text-gray-500 leading-relaxed">
            {monitoringStatus === null
              ? 'Monitoring status could not be read just now.'
              : monitoringStatus.monitoringEnabled
                ? 'Your monitors run on schedule. Matches appear above and in Monitoring.'
                : 'Your monitors and their surfaces are saved. Nothing is being crawled until '
                  + 'monitoring is switched back on — a quiet panel here means paused, not clear.'}
          </p>

          {monitoringStatus?.readiness?.platforms ? (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {Object.entries(monitoringStatus.readiness.platforms).map(([name, ready]) => (
                <span
                  key={name}
                  className={`text-2xs px-2 py-1 rounded border ${
                    ready
                      ? 'border-success/25 text-success bg-success/5'
                      : 'border-bg-border text-gray-600'
                  }`}
                >
                  {name}
                </span>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-4 mt-auto pt-3 border-t border-bg-border">
            <div>
              <p className="text-base font-bold text-white tabular-nums">
                {monitoringStatus?.activeMonitors ?? 0}
              </p>
              <p className="text-2xs text-gray-500">Active monitors</p>
            </div>
            <div>
              <p className="text-base font-bold text-white tabular-nums">
                {securityInsights?.crawlerAlerts.count ?? 0}
              </p>
              <p className="text-2xs text-gray-500">Matches found</p>
            </div>
          </div>
        </div>

        <div className="card flex flex-col">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Investigation reports</h2>
              <p className="text-2xs text-gray-500 mt-0.5">
                Saved in this browser · evidence you can reopen
              </p>
            </div>
            <Link to="/reports" className="btn btn-secondary btn-sm shrink-0">All reports</Link>
          </div>

          {reports.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
              <Search size={20} className="text-gray-600 mb-2" />
              <p className="text-sm text-gray-400">No investigations yet</p>
              <p className="text-2xs text-gray-500 mt-1 max-w-xs">
                Investigate a file to compare it against your protected work and produce an
                evidence report.
              </p>
              <Link to="/pinit-hub/investigation" className="btn btn-secondary btn-sm mt-3">
                Investigate a file
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-bg-border">
              {reports.map((report) => {
                const isInvestigation = report.kind === 'investigation';
                const name = isInvestigation ? report.filename : 'Comparison';
                const verdict = isInvestigation
                  ? (report.data.summary?.forensicVerdict
                     || report.data.summary?.riskLevel
                     || 'Report')
                  : 'Comparison';
                return (
                  <Link
                    to="/reports"
                    key={report.id}
                    className="flex items-center gap-3 py-2.5 hover:opacity-80"
                  >
                    <Activity size={13} className="text-dna-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white truncate">{name}</p>
                      <p className="text-2xs text-gray-500">
                        {String(verdict)}
                        {report.savedAt
                          ? ` · ${formatDistanceToNow(new Date(report.savedAt), { addSuffix: true })}`
                          : ''}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

      </section>

      <section>
        <h2 className="text-sm font-semibold text-white mb-3">Quick actions</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[
            { to: '/generate', label: 'Protect an asset', icon: <Zap size={15} className="text-white" />, tile: 'action-tile-dna' },
            { to: '/vault', label: 'My Assets', icon: <Archive size={15} className="text-white" />, tile: 'action-tile-purple' },
            { to: '/vault', label: 'Share secure link', icon: <Link2 size={15} className="text-white" />, tile: 'action-tile-cyan' },
            { to: '/monitoring', label: 'Monitoring', icon: <Radio size={15} className="text-white" />, tile: 'action-tile-success' },
          ].map((item) => (
            <Link key={item.label} to={item.to} className={`action-tile ${item.tile}`}>
              <span className={`action-icon action-icon-${item.tile.replace('action-tile-', '')}`}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </div>
      </section>

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
    </div>
  );
}
