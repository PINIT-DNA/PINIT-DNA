import { Link } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import {
  Database, Archive, Zap,
  AlertTriangle, RefreshCw,
  Eye, Globe, Plus, Link2, Radio, Download, Shield, FileText,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useApi, formatBytes } from '../hooks/useApi';
import {
  getDashboardStats, api, listVaultRecords, getLiveTrackingMap, deriveFileType,
  getDashboardSecurityInsights, type DashboardSecurityInsights,
} from '../services/dashboard.api';
import type { VaultRecord } from '../types/dashboard.types';
import { DashboardFilesMap, type DashboardFileMapPoint } from '../components/maps/DashboardFilesMap';
import { VaultFileThumbnail } from '../components/VaultFileThumbnail';
import { Badge, FileTypeBadge, ClassificationBadge } from '../components/ui/Badge';
import { FORENSIC_REPORTS_UPDATED_EVENT } from '../lib/forensic-reports-storage';
import { SkeletonCard } from '../components/ui/Skeleton';
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

type StatVariant = 'blue' | 'purple' | 'green' | 'orange';

const STAT_VARIANTS: Record<StatVariant, { card: string; icon: string; value: string }> = {
  blue:   { card: 'stat-card stat-card-blue',   icon: 'stat-icon stat-icon-blue',   value: 'text-gray-900' },
  purple: { card: 'stat-card stat-card-purple', icon: 'stat-icon stat-icon-purple', value: 'text-gray-900' },
  green:  { card: 'stat-card stat-card-green',  icon: 'stat-icon stat-icon-green',  value: 'text-gray-900' },
  orange: { card: 'stat-card stat-card-orange', icon: 'stat-icon stat-icon-orange', value: 'text-gray-900' },
};

function StatCard({
  icon, label, value, sub, variant, to,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  variant: StatVariant;
  to?: string;
}) {
  const v = STAT_VARIANTS[variant];
  const content = (
    <div className={`${v.card} group h-full ${to ? 'cursor-pointer' : ''}`}>
      <div className={v.icon}>{icon}</div>
      <p className={`text-xl font-extrabold mt-2 mb-0.5 tracking-tight ${v.value}`}>{value}</p>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      {sub && <p className="text-2xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : <div>{content}</div>;
}

function openNotificationBell() {
  window.dispatchEvent(new Event(OPEN_NOTIFICATION_BELL_EVENT));
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
    listVaultRecords()
      .then(setVaultRecords)
      .catch(() => setVaultRecords([]));
  }, [stats?.totalVaultRecords]);

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
    const id = setInterval(fetchTracking, 30_000);
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
    const id = setInterval(loadSecurity, 30_000);
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

  const handleRefresh = () => {
    refetch();
    setSecurityLoading(true);
    getDashboardSecurityInsights()
      .then(setSecurityInsights)
      .finally(() => setSecurityLoading(false));
    fetchShare();
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
    const onReportsUpdated = () => refetch();
    window.addEventListener(FORENSIC_REPORTS_UPDATED_EVENT, onReportsUpdated);
    return () => window.removeEventListener(FORENSIC_REPORTS_UPDATED_EVENT, onReportsUpdated);
  }, [refetch]);

  useEffect(() => {
    fetchShare();
    const id = setInterval(fetchShare, 30_000);
    return () => clearInterval(id);
  }, []);

  const attention = useMemo(() => {
    const suspiciousAccess = securityInsights?.duplicateAttempts.count ?? 0;
    const monitoringMatches = securityInsights?.crawlerAlerts.count ?? 0;
    const soon = Date.now() + 72 * 60 * 60 * 1000;
    let expiringShares = 0;
    for (const link of shareLinks) {
      if (!link.isActive || !link.expiresAt) continue;
      const exp = new Date(link.expiresAt).getTime();
      if (!Number.isNaN(exp) && exp <= soon && exp >= Date.now()) expiringShares += 1;
    }
    const securityEvents = (shareStats?.riskDistribution.HIGH ?? 0)
      + (shareStats?.riskDistribution.CRITICAL ?? 0);
    const rows = [
      { label: 'Suspicious access', value: suspiciousAccess },
      { label: 'Expiring shares', value: expiringShares },
      { label: 'Security events', value: securityEvents },
      { label: 'Monitoring matches', value: monitoringMatches },
    ];
    const total = rows.reduce((s, r) => s + r.value, 0);
    return { total, rows };
  }, [securityInsights, shareLinks, shareStats]);

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
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            Your assets are protected and under control.
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
            <h2 className="text-sm font-semibold text-white">Needs attention</h2>
            {securityLoading && !securityInsights ? (
              <div className="skeleton h-4 w-40 mt-2 rounded" />
            ) : attention.total === 0 ? (
              <p className="text-sm text-gray-400 mt-1">You&apos;re all caught up.</p>
            ) : (
              <p className="text-sm text-gray-400 mt-1">
                {attention.total} {attention.total === 1 ? 'item needs' : 'items need'} your attention
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={openNotificationBell}
          >
            Review notifications
          </button>
        </div>
        {!securityLoading && attention.total > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {attention.rows.map((row) => (
              <div key={row.label} className="rounded-lg border border-bg-border bg-bg-elevated px-3 py-2">
                <p className="text-lg font-bold text-white tabular-nums">{row.value}</p>
                <p className="text-2xs text-gray-500">{row.label}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white mb-3">Asset overview</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : stats ? (
          <>
            <StatCard
              icon={<Archive size={18} className="text-white" />}
              variant="purple"
              label="Protected assets"
              value={stats.totalVaultRecords}
              to="/vault"
            />
            <StatCard
              icon={<Database size={18} className="text-white" />}
              variant="blue"
              label="Storage used"
              value={formatBytes(stats.totalEncryptedBytes)}
              to="/vault"
            />
            <StatCard
              icon={<Link2 size={18} className="text-white" />}
              variant="green"
              label="Active shares"
              value={securityInsights?.activeShares.count ?? shareLinks.filter((l) => l.isActive).length}
              to="/access-intelligence"
            />
            <StatCard
              icon={<Radio size={18} className="text-white" />}
              variant="orange"
              label="Monitoring matches"
              value={securityInsights?.crawlerAlerts.count ?? 0}
              to="/monitoring"
            />
          </>
        ) : null}
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
