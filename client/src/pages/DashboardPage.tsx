import { Link } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import {
  Database, Archive, Shield, GitCompare, Zap,
  FileText, AlertTriangle, RefreshCw,
  Eye, Download, Printer, Copy, Camera, Globe, MapPin,
  Clock, BarChart2, AlertOctagon, Ban, Plus, Link2, Radio, ChevronRight,
} from 'lucide-react';
import { useApi, formatBytes } from '../hooks/useApi';
import {
  getDashboardStats, deriveFileType, api, listVaultRecords, getLiveTrackingMap,
  getDashboardSecurityInsights, type DashboardSecurityInsights,
} from '../services/dashboard.api';
import { FORENSIC_REPORTS_UPDATED_EVENT } from '../lib/forensic-reports-storage';
import { SkeletonCard } from '../components/ui/Skeleton';
import { BRAND } from '../config/brand.config';
import { toUserPinitId } from '../lib/pinit-identity';
import { Badge, FileTypeBadge, ClassificationBadge } from '../components/ui/Badge';
import { VaultFileThumbnail } from '../components/VaultFileThumbnail';
import { DashboardFilesMap, type DashboardFileMapPoint } from '../components/maps/DashboardFilesMap';
import type { VaultRecord } from '../types/dashboard.types';
import { formatDistanceToNow } from 'date-fns';
import { API_BASE_URL } from '../config/api.config';
import { useAuth } from '../context/AuthContext';
import { isRealDisplayName, useUserProfile } from '../hooks/useUserProfile';
import { UpgradeWelcomeModal } from '../components/subscription/UpgradeWelcomeModal';
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

// --- Stat card ----------------------------------------------------------------

type StatVariant = 'blue' | 'purple' | 'green' | 'orange';

const STAT_VARIANTS: Record<StatVariant, { card: string; icon: string; value: string }> = {
  blue:   { card: 'stat-card stat-card-blue',   icon: 'stat-icon stat-icon-blue',   value: 'text-gray-900' },
  purple: { card: 'stat-card stat-card-purple', icon: 'stat-icon stat-icon-purple', value: 'text-gray-900' },
  green:  { card: 'stat-card stat-card-green',  icon: 'stat-icon stat-icon-green',  value: 'text-gray-900' },
  orange: { card: 'stat-card stat-card-orange', icon: 'stat-icon stat-icon-orange', value: 'text-gray-900' },
};

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  variant: StatVariant;
  to?: string;
}

function StatCard({ icon, label, value, sub, variant, to }: StatCardProps) {
  const v = STAT_VARIANTS[variant];
  const content = (
    <div className={`${v.card} group h-full ${to ? 'cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={v.icon}>{icon}</div>
        {to && (
          <ChevronRight size={14} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
        )}
      </div>
      <p className={`text-3xl font-extrabold mb-0.5 tracking-tight ${v.value}`}>{value}</p>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      {sub && <p className="text-2xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : <div>{content}</div>;
}

// --- Security insight panel ---------------------------------------------------

interface InsightPanelProps {
  title: string;
  count: number;
  icon: React.ReactNode;
  variant: 'green' | 'rose' | 'cyan' | 'amber';
  to: string;
  hint?: string;
  children: React.ReactNode;
}

function InsightPanel({ title, count, icon, variant, to, hint, children }: InsightPanelProps) {
  return (
    <div className={`insight-panel insight-panel-${variant} flex flex-col h-full`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`insight-icon insight-icon-${variant}`}>{icon}</div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-slate-800 truncate">{title}</h3>
            {hint && <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{hint}</p>}
          </div>
        </div>
        <span className={`insight-count insight-count-${variant}`}>{count}</span>
      </div>
      <div className="flex-1 space-y-2 min-h-[88px]">{children}</div>
      <Link to={to} className={`insight-link insight-link-${variant} mt-3`}>
        View all <ChevronRight size={12} />
      </Link>
    </div>
  );
}

function InsightEmpty({ text }: { text: string }) {
  return (
    <div className="h-full flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/70 px-3 py-4">
      <p className="text-2xs text-slate-600 text-center leading-relaxed font-medium">{text}</p>
    </div>
  );
}

// --- Page ---------------------------------------------------------------------

export function DashboardPage() {
  const { user } = useAuth();
  const { firstName, displayName } = useUserProfile();
  const { data: stats, loading, error, refetch } = useApi(getDashboardStats, [], { cacheKey: 'dashboard-stats' });
  const [shareStats, setShareStats] = useState<ShareStats | null>(null);
  const [vaultRecords, setVaultRecords] = useState<VaultRecord[]>([]);
  const [trackingPoints, setTrackingPoints] = useState<DashboardFileMapPoint[]>([]);
  const [trackingMeta, setTrackingMeta] = useState({ recent: 0, total: 0 });
  const [securityInsights, setSecurityInsights] = useState<DashboardSecurityInsights | null>(null);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [welcomePlan, setWelcomePlan] = useState<PlanCode | null>(null);

  useEffect(() => {
    if (!user?.sub) return;
    const pending = consumePendingUpgradeWelcome(user.sub);
    if (pending && pending !== 'FREE') {
      setWelcomePlan(pending);
    }
  }, [user?.sub]);

  const vaultByDnaId = useMemo(
    () => new Map(vaultRecords.map(v => [v.dnaRecordId, v])),
    [vaultRecords],
  );

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

  const handleRefresh = () => {
    refetch();
    setSecurityLoading(true);
    getDashboardSecurityInsights()
      .then(setSecurityInsights)
      .finally(() => setSecurityLoading(false));
  };

  useEffect(() => {
    const onReportsUpdated = () => refetch();
    window.addEventListener(FORENSIC_REPORTS_UPDATED_EVENT, onReportsUpdated);
    return () => window.removeEventListener(FORENSIC_REPORTS_UPDATED_EVENT, onReportsUpdated);
  }, [refetch]);

  useEffect(() => {
    const fetch = () =>
      api.get(`${API_BASE_URL}/share/analytics/global`)
        .then(({ data }) => setShareStats((data as any).stats))
        .catch(() => {});
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => clearInterval(id);
  }, []);

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

  // Prefer saved profile fullName; fall back to Individual PINIT-USER id when name is unset
  const welcomeName = isRealDisplayName(displayName)
    ? firstName
    : (toUserPinitId(user?.shortId) || user?.shortId?.trim() || null);

  return (
    <div className="page-shell space-y-7 animate-fade-in">

      {/* -- Header ----------------------------------------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 mb-1">Home</p>
          <h1 className="text-xl sm:text-2xl font-bold text-gradient tracking-tight">
            {welcomeName ? `Hi ${welcomeName}` : 'Your files at a glance'}
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            See who opened what you shared — and what needs a look
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link to="/generate" className="btn btn-primary btn-sm gap-2">
            <Plus size={14} />
            Protect an asset
          </Link>
          <button onClick={handleRefresh} disabled={loading} className="btn btn-secondary btn-sm gap-2" title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* -- What matters now (activity-first) -------------------------------- */}
      <section className="home-attention">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Needs attention</h2>
            <p className="text-2xs text-gray-500 mt-0.5">Sharing, monitoring, and access updates</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {securityLoading && !securityInsights ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="insight-panel skeleton h-[200px] rounded-xl" />
          ))
        ) : (
          <>
            <InsightPanel
              title="Being viewed"
              count={securityInsights?.activeShares.count ?? 0}
              icon={<Link2 size={16} className="text-white" />}
              variant="green"
              to="/access-intelligence"
              hint="Files with live share links"
            >
              {(securityInsights?.activeShares.items.length ?? 0) > 0 ? (
                securityInsights!.activeShares.items.map((item, i) => (
                  <div key={i} className="insight-row">
                    <p className="text-xs font-medium text-slate-800 truncate">{item.filename}</p>
                    <p className="text-[10px] text-slate-500">{item.views} views · {item.ago}</p>
                  </div>
                ))
              ) : (
                <InsightEmpty text="No live share links yet — share a file from Digital Assets" />
              )}
            </InsightPanel>

            <InsightPanel
              title="Access stopped"
              count={securityInsights?.revokedShares.count ?? 0}
              icon={<Ban size={16} className="text-white" />}
              variant="rose"
              to="/access-intelligence"
              hint="Links you revoked"
            >
              {(securityInsights?.revokedShares.items.length ?? 0) > 0 ? (
                securityInsights!.revokedShares.items.map((item, i) => (
                  <div key={i} className="insight-row">
                    <p className="text-xs font-medium text-slate-800 truncate">{item.filename}</p>
                    <p className="text-[10px] text-slate-500">Access revoked · {item.ago}</p>
                  </div>
                ))
              ) : (
                <InsightEmpty text="No revoked links yet" />
              )}
            </InsightPanel>

            <InsightPanel
              title="Found online"
              count={securityInsights?.crawlerAlerts.count ?? 0}
              icon={<Radio size={16} className="text-white" />}
              variant="cyan"
              to="/monitoring"
              hint="Possible copies spotted on the web"
            >
              {(securityInsights?.crawlerAlerts.items.length ?? 0) > 0 ? (
                securityInsights!.crawlerAlerts.items.map((item, i) => (
                  <div key={i} className="insight-row">
                    <p className="text-xs font-medium text-slate-800 truncate">{item.filename}</p>
                    <p className="text-[10px] text-slate-500 truncate">
                      {item.matchType.replace(/_/g, ' ')} · {item.similarity}% · {item.url.replace(/^https?:\/\//, '').slice(0, 40)}
                    </p>
                  </div>
                ))
              ) : (
                <InsightEmpty text="No web matches yet — turn on Monitoring for important files" />
              )}
            </InsightPanel>

            <InsightPanel
              title="Someone tried your file"
              count={securityInsights?.duplicateAttempts.count ?? 0}
              icon={<Copy size={16} className="text-white" />}
              variant="amber"
              to="/duplicate-attempts"
              hint="Another account uploaded a matching file"
            >
              {(securityInsights?.duplicateAttempts.items.length ?? 0) > 0 ? (
                securityInsights!.duplicateAttempts.items.map((item, i) => (
                  <div key={i} className="insight-row">
                    <p className="text-xs font-medium text-slate-800 truncate">{item.filename}</p>
                    <p className="text-[10px] text-slate-500">
                      {item.matchType} · {item.riskLevel} risk · {item.ago}
                    </p>
                  </div>
                ))
              ) : (
                <InsightEmpty text="No one has tried to re-upload your protected files" />
              )}
            </InsightPanel>
          </>
        )}
        </div>
      </section>

      {/* -- Snapshot stats (secondary) -------------------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : stats ? (
          <>
            <StatCard
              icon={<Database size={20} className="text-white" />}
              variant="blue"
              label="Protected assets"
              value={stats.totalDnaRecords}
              sub={`${stats.completedDna} ready`}
              to="/dna-records"
            />
            <StatCard
              icon={<Archive size={20} className="text-white" />}
              variant="purple"
              label="Digital Assets"
              value={stats.totalVaultRecords}
              sub={formatBytes(stats.totalEncryptedBytes) + ' stored'}
              to="/vault"
            />
            <StatCard
              icon={<Shield size={20} className="text-white" />}
              variant="green"
              label="Secured"
              value={stats.completedDna}
              sub="Only you control access"
            />
            <StatCard
              icon={<GitCompare size={20} className="text-white" />}
              variant="orange"
              label="Investigations"
              value={stats.totalVerifications}
              sub="Reports & comparisons"
              to="/reports"
            />
          </>
        ) : null}
      </div>

      {/* -- System capabilities + recent activity ---------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">

        {/* Quick actions + live file tracking map */}
        <div className="card card-accent-teal flex flex-col h-full min-h-[420px]">
          <div className="mb-4 shrink-0">
            <h2 className="text-sm font-semibold text-white">Quick actions</h2>
            <p className="text-2xs text-gray-500 mt-0.5">Common next steps</p>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4 shrink-0">
            {[
              { to: '/generate', label: 'Protect an asset', icon: <Zap size={15} className="text-white" />, tile: 'action-tile-dna' },
              { to: BRAND.investigationPath, label: 'Investigate', icon: <Shield size={15} className="text-white" />, tile: 'action-tile-cyan' },
              { to: '/vault', label: 'Digital Assets', icon: <Archive size={15} className="text-white" />, tile: 'action-tile-purple' },
              { to: '/certificates', label: 'Certificates', icon: <Shield size={15} className="text-white" />, tile: 'action-tile-success' },
            ].map(item => (
              <Link
                key={item.to}
                to={item.to}
                className={`action-tile ${item.tile}`}
              >
                <span className={`action-icon action-icon-${item.tile.replace('action-tile-', '')}`}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            ))}
          </div>

          <div className="flex-1 flex flex-col min-h-0 border-t border-bg-border pt-4">
            <div className="flex items-center gap-2 mb-2 flex-wrap shrink-0">
              <Globe size={14} className="text-dna-400" />
              <h3 className="text-xs font-semibold text-white">Where assets were opened</h3>
              {trackingMeta.recent > 0 && (
                <Badge variant="success" dot>{trackingMeta.recent} in last hour</Badge>
              )}
              {trackingMeta.total > 0 && (
                <Badge variant="muted">{trackingMeta.total} locations</Badge>
              )}
            </div>
            <DashboardFilesMap points={trackingPoints} fill live />
          </div>
        </div>

        {/* Recent activity */}
        <div className="card card-accent-rose flex flex-col h-full min-h-[420px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Recently protected</h2>
            <Link to="/dna-records" className="text-xs text-dna-400 hover:text-dna-300 transition-colors">
              View all
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-12 rounded-lg" />
              ))}
            </div>
          ) : stats && stats.recentActivity.length > 0 ? (
            <div className="space-y-2">
              {stats.recentActivity.map(r => {
                const vaultId = r.vaultId ?? vaultByDnaId.get(r.id)?.id ?? null;
                return (
                  <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated border border-bg-border hover:border-dna-500/30 transition-all">
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
                      <p className="text-2xs text-gray-500 mono mt-0.5">
                        {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <ClassificationBadge value={r.status} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <FileText size={24} className="text-gray-500 mb-2" />
              <p className="text-sm text-gray-500">No protected assets yet</p>
              <p className="text-2xs text-gray-500 mt-1 max-w-[220px]">Protect an asset to start tracking who opens it</p>
              <Link to="/generate" className="btn btn-primary btn-sm mt-4">
                Protect an asset
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* -- Storage summary --------------------------------------------------- */}
      {!loading && stats && stats.totalVaultRecords > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Archive size={16} className="text-purple" />
              <h2 className="text-sm font-semibold text-white">Digital Assets storage</h2>
            </div>
            <Link to="/vault" className="text-xs text-dna-400 hover:text-dna-300 transition-colors">
              Open Digital Assets
            </Link>
          </div>
          <div className="stat-grid-3">
            <div className="p-3 rounded-xl bg-bg-elevated border border-bg-border text-center">
              <p className="text-xl font-bold text-purple">{stats.totalVaultRecords}</p>
              <p className="text-2xs text-gray-500 mt-1">Protected assets</p>
            </div>
            <div className="p-3 rounded-xl bg-bg-elevated border border-bg-border text-center">
              <p className="text-xl font-bold text-success">{formatBytes(stats.totalEncryptedBytes)}</p>
              <p className="text-2xs text-gray-500 mt-1">Stored securely</p>
            </div>
            <div className="p-3 rounded-xl bg-bg-elevated border border-bg-border text-center">
              <p className="text-xl font-bold text-dna-400">Protected</p>
              <p className="text-2xs text-gray-500 mt-1">Only you control access</p>
            </div>
          </div>
        </div>
      )}

      {/* -- Sharing activity ------------------------------------------------ */}
      {shareStats && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Sharing activity</h2>
            <p className="text-2xs text-gray-500 mt-0.5">Updates every 15 seconds</p>
          </div>

          <div>
            <p className="text-2xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Reach</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { icon: <Eye size={14} className="text-dna-400" />,    label: 'Views',       value: shareStats.totalViews },
                { icon: <Globe size={14} className="text-cyan" />,      label: 'Recipients',  value: shareStats.uniqueRecipients },
                { icon: <Globe size={14} className="text-blue-400" />,  label: 'Countries',   value: shareStats.countriesReached },
                { icon: <MapPin size={14} className="text-purple" />,   label: 'Cities',      value: shareStats.citiesReached },
                { icon: <Clock size={14} className="text-amber-400" />, label: 'Avg time',    value: shareStats.avgViewTimeSec > 0 ? `${shareStats.avgViewTimeSec}s` : '—' },
                { icon: <Download size={14} className="text-success" />,label: 'Downloads',   value: shareStats.downloads },
              ].map(m => (
                <div key={m.label} className="rounded-xl border border-bg-border bg-bg-card p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">{m.icon}<span className="text-2xs text-gray-500 font-medium">{m.label}</span></div>
                  <p className="text-xl font-bold text-white tabular-nums">{m.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-2xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Protection events</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { icon: <Ban size={14} className="text-red-400" />,        label: 'Blocked downloads', value: shareStats.blockedDownloads },
                { icon: <Printer size={14} className="text-orange-400" />, label: 'Print tries',       value: shareStats.printAttempts },
                { icon: <Copy size={14} className="text-yellow-400" />,    label: 'Copy tries',        value: shareStats.copyAttempts },
                { icon: <Camera size={14} className="text-pink-400" />,    label: 'Screenshot tries',  value: shareStats.screenshotAttempts },
                { icon: <BarChart2 size={14} className="text-gray-400" />, label: 'Forwards',          value: '—' },
                { icon: <AlertOctagon size={14} className="text-gray-400" />, label: 'Leaks',          value: '—' },
              ].map(m => (
                <div key={m.label} className="rounded-xl border border-bg-border bg-bg-card p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">{m.icon}<span className="text-2xs text-gray-500 font-medium">{m.label}</span></div>
                  <p className="text-xl font-bold text-white tabular-nums">{m.value}</p>
                </div>
              ))}
            </div>
          </div>

          {(shareStats.riskDistribution.LOW + shareStats.riskDistribution.MEDIUM + shareStats.riskDistribution.HIGH + shareStats.riskDistribution.CRITICAL) > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={14} className="text-dna-400" />
                <h3 className="text-xs font-semibold text-white">Viewer risk levels</h3>
              </div>
              <div className="stat-grid-4">
                {([
                  { key: 'LOW' as const,      label: 'Low',      color: 'text-green-400',  bg: 'bg-green-500/15 border-green-500/30'  },
                  { key: 'MEDIUM' as const,   label: 'Medium',   color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30' },
                  { key: 'HIGH' as const,     label: 'High',     color: 'text-orange-400', bg: 'bg-orange-500/15 border-orange-500/30' },
                  { key: 'CRITICAL' as const, label: 'Critical', color: 'text-red-400',    bg: 'bg-red-500/15 border-red-500/30'       },
                ]).map(({ key, label, color, bg }) => (
                  <div key={key} className={`rounded-xl border p-3 text-center ${bg}`}>
                    <p className={`text-xl font-bold tabular-nums ${color}`}>{shareStats.riskDistribution[key]}</p>
                    <p className="text-2xs text-gray-500 mt-0.5 font-medium">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
