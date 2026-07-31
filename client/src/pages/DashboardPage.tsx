import { Link } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import {
  Database, Archive, Shield, GitCompare, Zap, TrendingUp,
  FileText, CheckCircle2, AlertTriangle, RefreshCw,
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
import { Badge, FileTypeBadge, ClassificationBadge } from '../components/ui/Badge';
import { VaultFileThumbnail } from '../components/VaultFileThumbnail';
import { DashboardFilesMap, type DashboardFileMapPoint } from '../components/maps/DashboardFilesMap';
import type { VaultRecord } from '../types/dashboard.types';
import { formatDistanceToNow } from 'date-fns';
import { API_BASE_URL } from '../config/api.config';
import { useAuth } from '../context/AuthContext';
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
    <div className={`${v.card} group h-full cursor-pointer`}>
      <div className="flex items-start justify-between mb-3">
        <div className={v.icon}>{icon}</div>
        <TrendingUp size={14} className="text-gray-400 group-hover:opacity-80 transition-opacity" />
      </div>
      <p className={`text-3xl font-extrabold mb-0.5 tracking-tight ${v.value}`}>{value}</p>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      {sub && <p className="text-2xs text-slate-400 mt-1 mono">{sub}</p>}
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
  const { data: stats, loading, error, refetch } = useApi(getDashboardStats);
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
    const id = setInterval(fetchTracking, 15_000);
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
    const id = setInterval(fetch, 15_000);
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

  return (
    <div className="page-shell space-y-6 animate-fade-in">

      {/* -- Header ----------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-gradient">Forensic Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Universal File DNA · Real-time system overview
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Generate DNA — shown on mobile/APK (top-bar's button is hidden there) */}
          <Link to="/generate" className="btn btn-primary btn-sm gap-2 sm:hidden">
            <Plus size={14} />
            Generate DNA
          </Link>
          <button onClick={handleRefresh} disabled={loading} className="btn btn-secondary btn-sm gap-2">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* -- Stat cards ------------------------------------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : stats ? (
          <>
            <StatCard
              icon={<Database size={20} className="text-white" />}
              variant="blue"
              label="DNA Records"
              value={stats.totalDnaRecords}
              sub={`${stats.completedDna} complete`}
              to="/dna-records"
            />
            <StatCard
              icon={<Archive size={20} className="text-white" />}
              variant="purple"
              label="Vault Records"
              value={stats.totalVaultRecords}
              sub={formatBytes(stats.totalEncryptedBytes) + ' encrypted'}
              to="/vault"
            />
            <StatCard
              icon={<Shield size={20} className="text-white" />}
              variant="green"
              label="Verified Files"
              value={stats.completedDna}
              sub="AES-256-GCM secured"
            />
            <StatCard
              icon={<GitCompare size={20} className="text-white" />}
              variant="orange"
              label="Forensic Reports"
              value={stats.totalVerifications}
              sub="Investigations & comparisons"
              to="/reports"
            />
          </>
        ) : null}
      </div>

      {/* -- Security & sharing insights ------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {securityLoading && !securityInsights ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="insight-panel skeleton h-[200px] rounded-xl" />
          ))
        ) : (
          <>
            <InsightPanel
              title="Active Shares"
              count={securityInsights?.activeShares.count ?? 0}
              icon={<Link2 size={16} className="text-white" />}
              variant="green"
              to="/access-intelligence"
            >
              {(securityInsights?.activeShares.items.length ?? 0) > 0 ? (
                securityInsights!.activeShares.items.map((item, i) => (
                  <div key={i} className="insight-row">
                    <p className="text-xs font-medium text-slate-800 truncate">{item.filename}</p>
                    <p className="text-[10px] text-slate-500">{item.views} views · {item.ago}</p>
                  </div>
                ))
              ) : (
                <InsightEmpty text="No live share links — create one from Vault" />
              )}
            </InsightPanel>

            <InsightPanel
              title="Revokes"
              count={securityInsights?.revokedShares.count ?? 0}
              icon={<Ban size={16} className="text-white" />}
              variant="rose"
              to="/access-intelligence"
            >
              {(securityInsights?.revokedShares.items.length ?? 0) > 0 ? (
                securityInsights!.revokedShares.items.map((item, i) => (
                  <div key={i} className="insight-row">
                    <p className="text-xs font-medium text-slate-800 truncate">{item.filename}</p>
                    <p className="text-[10px] text-slate-500">Revoked · {item.ago}</p>
                  </div>
                ))
              ) : (
                <InsightEmpty text="No revoked links yet" />
              )}
            </InsightPanel>

            <InsightPanel
              title="Crawler Alerts"
              count={securityInsights?.crawlerAlerts.count ?? 0}
              icon={<Radio size={16} className="text-white" />}
              variant="cyan"
              to="/monitoring"
              hint="Where your file was found online"
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
                <InsightEmpty text="No web matches yet — enroll files in Monitoring & Crawler" />
              )}
            </InsightPanel>

            <InsightPanel
              title="Duplicate Attempts"
              count={securityInsights?.duplicateAttempts.count ?? 0}
              icon={<Copy size={16} className="text-white" />}
              variant="amber"
              to="/duplicate-attempts"
              hint="Another PINIT account tried your file"
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
                <InsightEmpty text="No one has tried to upload your protected files" />
              )}
            </InsightPanel>
          </>
        )}
      </div>

      {/* -- System capabilities + recent activity ---------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">

        {/* Quick actions + live file tracking map */}
        <div className="card card-accent-teal flex flex-col h-full min-h-[420px]">
          <h2 className="text-sm font-semibold text-white mb-4 shrink-0">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-2 mb-4 shrink-0">
            {[
              { to: '/generate', label: 'Generate DNA', icon: <Zap size={15} className="text-white" />, tile: 'action-tile-dna' },
              { to: BRAND.investigationPath, label: 'Investigate', icon: <Shield size={15} className="text-white" />, tile: 'action-tile-cyan' },
              { to: '/vault', label: 'Vault', icon: <Archive size={15} className="text-white" />, tile: 'action-tile-purple' },
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
              <h3 className="text-xs font-semibold text-white">Live File Tracking</h3>
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
            <h2 className="text-sm font-semibold text-white">Recent DNA Records</h2>
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
                const vault = r.vaultId
                  ? vaultRecords.find(v => v.id === r.vaultId) ?? vaultByDnaId.get(r.id)
                  : vaultByDnaId.get(r.id);
                return (
                  <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated border border-bg-border hover:border-dna-500/30 transition-all">
                    {vault ? (
                      <VaultFileThumbnail
                        vaultId={vault.id}
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
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileText size={24} className="text-gray-600 mb-2" />
              <p className="text-sm text-gray-500">No DNA records yet</p>
              <Link to="/generate" className="btn btn-primary btn-sm mt-3">
                Generate First DNA
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
              <h2 className="text-sm font-semibold text-white">Vault Storage</h2>
            </div>
            <Link to="/vault" className="text-xs text-dna-400 hover:text-dna-300 transition-colors">
              Open Vault ?
            </Link>
          </div>
          <div className="stat-grid-3">
            <div className="p-3 rounded-xl bg-bg-elevated border border-bg-border text-center">
              <p className="text-xl font-bold text-purple">{stats.totalVaultRecords}</p>
              <p className="text-2xs text-gray-500 mt-1">Encrypted Files</p>
            </div>
            <div className="p-3 rounded-xl bg-bg-elevated border border-bg-border text-center">
              <p className="text-xl font-bold text-success">{formatBytes(stats.totalEncryptedBytes)}</p>
              <p className="text-2xs text-gray-500 mt-1">Total Encrypted</p>
            </div>
            <div className="p-3 rounded-xl bg-bg-elevated border border-bg-border text-center">
              <p className="text-xl font-bold text-dna-400">AES-256-GCM</p>
              <p className="text-2xs text-gray-500 mt-1">Encryption Standard</p>
            </div>
          </div>
        </div>
      )}

      {/* -- Smart Link Analytics --------------------------------------------- */}
      {shareStats && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Eye size={15} className="text-dna-400" />
            <h2 className="text-sm font-semibold text-white">Smart Link Analytics</h2>
            <span className="text-2xs text-gray-600 ml-1">� live � auto-refreshes every 15s</span>
          </div>

          {/* Row 1 � reach metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { icon: <Eye size={14} className="text-dna-400" />,    label: 'Total Views',       value: shareStats.totalViews,        color: 'bg-dna-500/10 border-dna-500/20' },
              { icon: <Globe size={14} className="text-cyan" />,      label: 'Unique Recipients', value: shareStats.uniqueRecipients,   color: 'bg-cyan/10 border-cyan/20' },
              { icon: <Globe size={14} className="text-blue-400" />,  label: 'Countries',         value: shareStats.countriesReached,   color: 'bg-blue-500/10 border-blue-500/20' },
              { icon: <MapPin size={14} className="text-purple" />,   label: 'Cities',            value: shareStats.citiesReached,      color: 'bg-purple/10 border-purple/20' },
              { icon: <Clock size={14} className="text-amber-400" />, label: 'Avg View Time',     value: shareStats.avgViewTimeSec > 0 ? `${shareStats.avgViewTimeSec}s` : '�', color: 'bg-amber-500/10 border-amber-500/20' },
              { icon: <Download size={14} className="text-success" />,label: 'Downloads',         value: shareStats.downloads,          color: 'bg-success/10 border-success/20' },
            ].map(m => (
              <div key={m.label} className={`rounded-xl border p-3 ${m.color}`}>
                <div className="flex items-center gap-1.5 mb-1.5">{m.icon}<span className="text-2xs text-gray-500 font-medium">{m.label}</span></div>
                <p className="text-xl font-bold text-white">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Row 2 � violation/security metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { icon: <Ban size={14} className="text-red-400" />,        label: 'Blocked Downloads', value: shareStats.blockedDownloads,   color: 'bg-red-500/10 border-red-500/20' },
              { icon: <Printer size={14} className="text-orange-400" />, label: 'Print Attempts',    value: shareStats.printAttempts,      color: 'bg-orange-500/10 border-orange-500/20' },
              { icon: <Copy size={14} className="text-yellow-400" />,    label: 'Copy Attempts',     value: shareStats.copyAttempts,       color: 'bg-yellow-500/10 border-yellow-500/20' },
              { icon: <Camera size={14} className="text-pink-400" />,    label: 'Screenshot Attempts', value: shareStats.screenshotAttempts, color: 'bg-pink-500/10 border-pink-500/20' },
              { icon: <BarChart2 size={14} className="text-gray-400" />, label: 'Forward Chains',    value: '�',                           color: 'bg-gray-500/10 border-gray-500/20' },
              { icon: <AlertOctagon size={14} className="text-gray-400" />, label: 'Leak Incidents', value: '�',                           color: 'bg-gray-500/10 border-gray-500/20' },
            ].map(m => (
              <div key={m.label} className={`rounded-xl border p-3 ${m.color}`}>
                <div className="flex items-center gap-1.5 mb-1.5">{m.icon}<span className="text-2xs text-gray-500 font-medium">{m.label}</span></div>
                <p className="text-xl font-bold text-white">{m.value}</p>
              </div>
            ))}
          </div>

          {/* Risk score distribution */}
          {(shareStats.riskDistribution.LOW + shareStats.riskDistribution.MEDIUM + shareStats.riskDistribution.HIGH + shareStats.riskDistribution.CRITICAL) > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={14} className="text-dna-400" />
                <h3 className="text-xs font-semibold text-white">Risk Score Distribution</h3>
              </div>
              <div className="stat-grid-4">
                {([
                  { key: 'LOW',      color: 'text-green-400',  bg: 'bg-green-500/15 border-green-500/30'  },
                  { key: 'MEDIUM',   color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30' },
                  { key: 'HIGH',     color: 'text-orange-400', bg: 'bg-orange-500/15 border-orange-500/30' },
                  { key: 'CRITICAL', color: 'text-red-400',    bg: 'bg-red-500/15 border-red-500/30'       },
                ] as const).map(({ key, color, bg }) => (
                  <div key={key} className={`rounded-xl border p-3 text-center ${bg}`}>
                    <p className={`text-xl font-bold ${color}`}>{shareStats.riskDistribution[key]}</p>
                    <p className="text-2xs text-gray-500 mt-0.5 font-medium">{key}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* -- Quick actions ----------------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: '/generate',    icon: <Database size={16} />,  label: 'Generate DNA',      color: 'hover:border-dna-500/50'    },
          { to: BRAND.investigationPath, icon: <Shield size={16} />, label: 'Investigate', color: 'hover:border-cyan/50' },
          { to: '/vault',       icon: <Archive size={16} />,    label: 'Browse Vault',      color: 'hover:border-purple/50'     },
          { to: '/certificates',icon: <CheckCircle2 size={16}/>,label: 'Certificates',      color: 'hover:border-success/50'    },
        ].map(a => (
          <Link
            key={a.to}
            to={a.to}
            className={`card-sm flex items-center gap-3 transition-all duration-200 group border border-bg-border ${a.color} hover:bg-bg-elevated cursor-pointer`}
          >
            <span className="text-gray-500 group-hover:text-dna-400 transition-colors">{a.icon}</span>
            <span className="text-sm font-medium text-gray-400 group-hover:text-white transition-colors">{a.label}</span>
          </Link>
        ))}
      </div>

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
