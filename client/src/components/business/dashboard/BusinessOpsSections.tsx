import { Link, useNavigate } from 'react-router-dom';
import {
  Shield, Archive, Dna, AlertTriangle, HardDrive, Users, Share2, Award,
  Activity, Bell, FileSearch, Radio, FileText, ChevronRight, RefreshCw,
  Upload, UserPlus, Globe, Eye, Download, Building2, Crown,
  Briefcase, Search, Filter, Zap, KeyRound, BarChart2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '../../ui/utils';
import { formatBytes } from '../../../hooks/useApi';
import { VaultFileThumbnail } from '../../VaultFileThumbnail';
import { BRAND } from '../../../config/brand.config';
import {
  ACTIVITY_ICONS,
  ACTIVITY_LABELS,
  fmtAgo,
  type ActivityEvent,
  type BusinessDashboardData,
  type CrawlAlertPreview,
  type ShareLinkPreview,
} from '../../../hooks/useBusinessDashboard';
import {
  notificationTypeConfig,
  resolveNotificationDeepLink,
  NOTIFICATION_SEVERITY_BORDER,
  type NotificationItem,
} from '../../../lib/notification-config';
import type { VaultRecord } from '../../../types/dashboard.types';
import type { StoredForensicReport } from '../../../lib/forensic-reports-storage';
import { investigationListSubtitle, investigationVerdictLabel } from '../../../lib/forensic-report-display';
import { useState, useMemo } from 'react';
import { api } from '../../../services/dashboard.api';
import { API_BASE_URL } from '../../../config/api.config';

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionCard({
  title,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-bg-border bg-bg-card overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-bg-border/80">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function MetricTile({
  label,
  value,
  sub,
  icon,
  to,
  accent = 'dna',
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  to?: string;
  accent?: 'dna' | 'emerald' | 'amber' | 'purple' | 'rose' | 'cyan';
}) {
  const accents = {
    dna: 'text-dna-400 bg-dna-500/10 border-dna-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    cyan: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  };
  const inner = (
    <div className={cn('rounded-xl border p-3.5 h-full transition-colors hover:bg-bg-elevated/50', accents[accent].split(' ').slice(2).join(' '))}>
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-2', accents[accent].split(' ').slice(0, 2).join(' '))}>
        {icon}
      </div>
      <p className="text-2xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-white mt-0.5 tabular-nums">{value}</p>
      {sub && <p className="text-2xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-6 text-center">
      <p className="text-xs text-gray-500">{text}</p>
    </div>
  );
}

// ─── 1. Organization Overview ─────────────────────────────────────────────────

export function OrgOverviewGrid({
  protectedAssets,
  dnaGenerated,
  activeInvestigations,
  threatAlerts,
  storageUsed,
  storageLimit,
  teamDisplay,
  sharedAssets,
  certificates,
}: {
  protectedAssets: number;
  dnaGenerated: number;
  activeInvestigations: number;
  threatAlerts: number;
  storageUsed: number;
  storageLimit: number | null;
  teamDisplay: string;
  sharedAssets: number;
  certificates: number;
}) {
  const storageLabel = storageLimit
    ? `${formatBytes(storageUsed)} / ${formatBytes(storageLimit)}`
    : formatBytes(storageUsed);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
      <MetricTile label="Protected Assets" value={protectedAssets} icon={<Shield size={16} />} to="/vault" accent="dna" />
      <MetricTile label="DNA Generated" value={dnaGenerated} icon={<Dna size={16} />} to="/dna-records" accent="purple" />
      <MetricTile label="Investigations" value={activeInvestigations} icon={<FileSearch size={16} />} to={BRAND.investigationPath} accent="cyan" />
      <MetricTile label="Threat Alerts" value={threatAlerts} icon={<AlertTriangle size={16} />} to="/monitoring" accent="amber" />
      <MetricTile label="Storage Used" value={storageLabel} icon={<HardDrive size={16} />} to="/vault" accent="emerald" />
      <MetricTile label="Team Members" value={teamDisplay} icon={<Users size={16} />} to="/business/settings" accent="purple" />
      <MetricTile label="Shared Assets" value={sharedAssets} icon={<Share2 size={16} />} to="/access-intelligence" accent="cyan" />
      <MetricTile label="Certificates" value={certificates} icon={<Award size={16} />} to="/certificates" accent="rose" />
    </div>
  );
}

// ─── 2. Live Activity Feed ────────────────────────────────────────────────────

export function LiveActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <SectionCard
      title="What happened today"
      icon={<Activity size={16} className="text-dna-400" />}
      action={
        <Link to="/profile" className="text-2xs text-dna-400 hover:text-dna-300 flex items-center gap-1">
          Full timeline <ChevronRight size={12} />
        </Link>
      }
    >
      {events.length === 0 ? (
        <EmptyHint text="Organization activity will appear here — uploads, DNA, shares, certificates, and access events." />
      ) : (
        <ul className="space-y-1 max-h-[320px] overflow-y-auto pr-1">
          {events.slice(0, 12).map((e) => (
            <li
              key={`${e.type}-${e.id}`}
              className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-bg-elevated/60 transition-colors"
            >
              <span className={cn('text-2xs font-semibold uppercase mt-1 w-24 shrink-0', ACTIVITY_ICONS[e.type] ?? 'text-gray-400')}>
                {ACTIVITY_LABELS[e.type] ?? e.type.replace(/_/g, ' ')}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white truncate">{e.detail}</p>
                <p className="text-2xs text-gray-600">{fmtAgo(e.date)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ─── 3. Active Alerts ─────────────────────────────────────────────────────────

interface AlertItem {
  id: string;
  category: 'security' | 'investigation' | 'monitoring' | 'billing' | 'storage' | 'system';
  title: string;
  detail: string;
  severity: 'critical' | 'warning' | 'info';
  to: string;
}

export function ActiveAlertsPanel({
  security,
  pendingAlerts,
  storagePct,
  planName,
}: {
  security: BusinessDashboardData['security'];
  pendingAlerts: CrawlAlertPreview[];
  storagePct: number | null;
  planName: string;
}) {
  const alerts = useMemo(() => {
    const items: AlertItem[] = [];

    for (const a of pendingAlerts.slice(0, 3)) {
      items.push({
        id: `mon-${a.id}`,
        category: 'monitoring',
        title: 'Crawler match pending',
        detail: `${a.filename} · ${Math.round((a.similarity <= 1 ? a.similarity * 100 : a.similarity))}% · ${a.matchType}`,
        severity: a.matchType.includes('EXACT') ? 'critical' : 'warning',
        to: '/monitoring',
      });
    }

    for (const d of security?.duplicateAttempts.items ?? []) {
      items.push({
        id: `dup-${d.filename}-${d.ago}`,
        category: 'security',
        title: 'Duplicate upload attempt',
        detail: `${d.filename} · ${d.riskLevel} · ${d.ago}`,
        severity: d.riskLevel === 'CRITICAL' || d.riskLevel === 'HIGH' ? 'critical' : 'warning',
        to: '/duplicate-attempts',
      });
    }

    if (storagePct != null && storagePct >= 85) {
      items.push({
        id: 'storage-warn',
        category: 'storage',
        title: 'Storage nearing limit',
        detail: `${Math.round(storagePct)}% of organization storage used`,
        severity: storagePct >= 95 ? 'critical' : 'warning',
        to: '/vault',
      });
    }

    if (planName === 'Free') {
      items.push({
        id: 'billing-free',
        category: 'billing',
        title: 'Free plan limits active',
        detail: '5 protected assets · upgrade for teams & Enterprise modules',
        severity: 'info',
        to: '/upgrade',
      });
    }

    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return items
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
      .slice(0, 8);
  }, [pendingAlerts, security, storagePct, planName]);

  const catColors: Record<AlertItem['category'], string> = {
    security: 'text-red-400',
    investigation: 'text-cyan-400',
    monitoring: 'text-amber-400',
    billing: 'text-purple-400',
    storage: 'text-emerald-400',
    system: 'text-gray-400',
  };

  return (
    <SectionCard
      title="Active Alerts"
      icon={<AlertTriangle size={16} className="text-amber-400" />}
      action={
        <span className="text-2xs text-gray-500">{alerts.length} prioritized</span>
      }
    >
      {alerts.length === 0 ? (
        <EmptyHint text="No active alerts — security, monitoring, and system status look clear." />
      ) : (
        <ul className="space-y-2 max-h-[320px] overflow-y-auto">
          {alerts.map((a) => (
            <li key={a.id}>
              <Link
                to={a.to}
                className={cn(
                  'block rounded-lg border px-3 py-2.5 transition-colors hover:bg-bg-elevated',
                  a.severity === 'critical' ? 'border-red-500/30 bg-red-500/5' :
                  a.severity === 'warning' ? 'border-amber-500/25 bg-amber-500/5' :
                  'border-bg-border bg-bg-elevated/40',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-white">{a.title}</p>
                  <span className={cn('text-2xs capitalize', catColors[a.category])}>{a.category}</span>
                </div>
                <p className="text-2xs text-gray-500 mt-0.5 line-clamp-2">{a.detail}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ─── 4. Notifications Center ────────────────────────────────────────────────

export function BusinessNotificationsPanel({
  notifications,
  unreadCount,
  onRefresh,
}: {
  notifications: NotificationItem[];
  unreadCount: number;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [category, setCategory] = useState('');

  const filtered = notifications.filter((n) => {
    if (filter === 'unread' && n.read) return false;
    if (category && n.category !== category) return false;
    return true;
  });

  const markAllRead = async () => {
    await api.put(`${API_BASE_URL}/notifications/read-all`);
    onRefresh();
  };

  const archiveItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.put(`${API_BASE_URL}/notifications/${id}/archive`);
    onRefresh();
  };

  return (
    <SectionCard
      title="Notifications Center"
      icon={<Bell size={16} className="text-dna-400" />}
      action={
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="text-2xs px-2 py-0.5 rounded-full bg-dna-500/20 text-dna-300 font-semibold">
              {unreadCount} unread
            </span>
          )}
          <button type="button" onClick={() => void markAllRead()} className="text-2xs text-gray-400 hover:text-white">
            Mark all read
          </button>
          <Link to="/profile" className="text-2xs text-dna-400 hover:text-dna-300">
            View all
          </Link>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2 mb-3">
        {(['all', 'unread'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'text-2xs px-2.5 py-1 rounded-lg border capitalize',
              filter === f ? 'border-dna-500/40 bg-dna-500/10 text-dna-300' : 'border-bg-border text-gray-500',
            )}
          >
            {f}
          </button>
        ))}
        {['', 'security', 'monitoring', 'vault', 'sharing', 'investigation'].map((c) => (
          <button
            key={c || 'all-cat'}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              'text-2xs px-2.5 py-1 rounded-lg border capitalize',
              category === c ? 'border-dna-500/40 bg-dna-500/10 text-dna-300' : 'border-bg-border text-gray-500',
            )}
          >
            {c || 'All'}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyHint text="No notifications in this view." />
      ) : (
        <ul className="space-y-2 max-h-[240px] overflow-y-auto">
          {filtered.slice(0, 6).map((n) => {
            const cfg = notificationTypeConfig(n.type);
            const border = NOTIFICATION_SEVERITY_BORDER[n.severity] ?? '';
            return (
              <li key={n.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(resolveNotificationDeepLink(n))}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(resolveNotificationDeepLink(n))}
                  className={cn(
                    'group flex items-start gap-2.5 rounded-lg px-3 py-2 border border-bg-border border-l-2 cursor-pointer hover:bg-bg-elevated/60',
                    border,
                    n.read ? 'opacity-75' : '',
                  )}
                >
                  <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0', cfg.color)}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{n.title}</p>
                    <p className="text-2xs text-gray-500 line-clamp-1">{n.body}</p>
                    <p className="text-2xs text-gray-600 mt-0.5">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  {!n.read && <span className="w-2 h-2 bg-dna-500 rounded-full shrink-0 mt-2" />}
                  <button
                    type="button"
                    onClick={(e) => void archiveItem(n.id, e)}
                    className="text-2xs text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 shrink-0"
                  >
                    Archive
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

// ─── 5–10. Module snapshots ─────────────────────────────────────────────────

export function InvestigationSnapshot({ investigations }: { investigations: StoredForensicReport[] }) {
  const recent = investigations.slice(0, 4);
  return (
    <SectionCard
      title="Unified Investigation"
      icon={<FileSearch size={16} className="text-cyan-400" />}
      action={
        <Link to={BRAND.investigationPath} className="text-2xs text-dna-400 hover:text-dna-300 flex items-center gap-1">
          Open module <ChevronRight size={12} />
        </Link>
      }
    >
      {recent.length === 0 ? (
        <EmptyHint text="No organization investigations yet. Start one from a probe file or vault asset." />
      ) : (
        <ul className="space-y-2">
          {recent.map((r) => {
            if (r.kind !== 'investigation') return null;
            return (
              <li key={r.id} className="rounded-lg border border-bg-border bg-bg-elevated/40 px-3 py-2">
                <p className="text-xs font-medium text-white truncate">{r.filename}</p>
                <p className="text-2xs text-gray-500">{investigationListSubtitle(r.data, r.filename)}</p>
                <p className="text-2xs text-cyan-400/80 mt-0.5">
                  {investigationVerdictLabel(r.data)} · {fmtAgo(r.savedAt)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

export function VaultExplorerSnapshot({
  records,
  workspaceName,
  ownerName,
}: {
  records: VaultRecord[];
  workspaceName: string;
  ownerName: string;
}) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'COMPLETE' | 'PARTIAL'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (statusFilter !== 'all' && r.dnaRecord?.status !== statusFilter) return false;
      if (search && !r.originalFileName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [records, statusFilter, search]);

  return (
    <SectionCard
      title="Vault Explorer"
      icon={<Archive size={16} className="text-emerald-400" />}
      action={
        <Link to="/vault" className="text-2xs text-dna-400 hover:text-dna-300 flex items-center gap-1">
          Open explorer <ChevronRight size={12} />
        </Link>
      }
    >
      <div className="flex flex-wrap gap-2 mb-3">
        <span className="text-2xs px-2 py-1 rounded border border-bg-border text-gray-400">
          <Filter size={10} className="inline mr-1" />
          Workspace: {workspaceName}
        </span>
        <span className="text-2xs px-2 py-1 rounded border border-bg-border text-gray-400">
          Owner: {ownerName}
        </span>
        {(['all', 'COMPLETE', 'PARTIAL'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(
              'text-2xs px-2 py-1 rounded border capitalize',
              statusFilter === s ? 'border-dna-500/40 text-dna-300 bg-dna-500/10' : 'border-bg-border text-gray-500',
            )}
          >
            {s === 'all' ? 'All status' : s.toLowerCase()}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search assets…"
          className="text-2xs flex-1 min-w-[120px] bg-bg-elevated border border-bg-border rounded px-2 py-1 text-gray-300"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyHint text="No organization assets match filters." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {filtered.slice(0, 6).map((r) => (
            <Link
              key={r.id}
              to="/vault"
              className="rounded-lg border border-bg-border bg-bg-elevated/40 p-2 hover:border-dna-500/30 transition-colors"
            >
              <VaultFileThumbnail
                vaultId={r.id}
                fileName={r.originalFileName}
                mimeType={r.originalMimeType}
                className="w-full aspect-square rounded-md mb-1.5"
              />
              <p className="text-2xs text-white truncate">{r.originalFileName}</p>
              <p className="text-2xs text-gray-600">{r.dnaRecord?.status ?? '—'}</p>
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function AccessIntelligenceSnapshot({ links, shareStats }: { links: ShareLinkPreview[]; shareStats: BusinessDashboardData['shareStats'] }) {
  const topAssets = [...links].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0)).slice(0, 4);
  const allLogs = links.flatMap((l) =>
    (l.accessLogs ?? []).map((log: ShareLinkPreview['accessLogs'][number]) => ({ ...log, filename: l.filename })),
  );
  const recentViewers = allLogs
    .filter((l) => l.action === 'VIEWED')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);

  return (
    <SectionCard
      title="Access Intelligence"
      icon={<Globe size={16} className="text-blue-400" />}
      action={
        <Link to="/access-intelligence" className="text-2xs text-dna-400 hover:text-dna-300 flex items-center gap-1">
          Organization analytics <ChevronRight size={12} />
        </Link>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <MiniStat icon={<Eye size={12} />} label="Views" value={shareStats?.totalViews ?? links.reduce((s, l) => s + l.viewCount, 0)} />
        <MiniStat icon={<Download size={12} />} label="Downloads" value={shareStats?.downloads ?? links.reduce((s, l) => s + (l.downloadCount ?? 0), 0)} />
        <MiniStat icon={<Share2 size={12} />} label="Active links" value={links.filter((l) => l.isActive).length} />
        <MiniStat icon={<Globe size={12} />} label="Countries" value={shareStats?.countriesReached ?? new Set(allLogs.map((l) => l.country).filter(Boolean)).size} />
      </div>
      {topAssets.length === 0 ? (
        <EmptyHint text="Share organization assets to track views, downloads, and viewer intelligence." />
      ) : (
        <ul className="space-y-1.5">
          {topAssets.map((l) => (
            <li key={l.id} className="flex items-center justify-between text-2xs rounded px-2 py-1.5 bg-bg-elevated/40">
              <span className="text-gray-300 truncate flex-1">{l.filename}</span>
              <span className="text-dna-400 shrink-0 ml-2">{l.viewCount} views</span>
            </li>
          ))}
        </ul>
      )}
      {recentViewers.length > 0 && (
        <p className="text-2xs text-gray-600 mt-2 pt-2 border-t border-bg-border">
          Recent: {recentViewers.map((v) => `${v.country ?? 'Unknown'} · ${v.device ?? 'device'}`).join(' · ')}
        </p>
      )}
    </SectionCard>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-bg-elevated/50 border border-bg-border px-2 py-1.5">
      <div className="flex items-center gap-1 text-gray-500 text-2xs">{icon}{label}</div>
      <p className="text-sm font-bold text-white tabular-nums">{value}</p>
    </div>
  );
}

export function MonitoringSnapshot({
  stats,
  alerts,
}: {
  stats: BusinessDashboardData['monitorStats'];
  alerts: CrawlAlertPreview[];
}) {
  return (
    <SectionCard
      title="Monitoring"
      icon={<Radio size={16} className="text-amber-400" />}
      action={
        <Link to="/monitoring" className="text-2xs text-dna-400 hover:text-dna-300 flex items-center gap-1">
          Monitoring engine <ChevronRight size={12} />
        </Link>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <MiniStat icon={<Radio size={12} />} label="Monitored" value={stats?.totalMonitored ?? 0} />
        <MiniStat icon={<Zap size={12} />} label="Active" value={stats?.activeMonitors ?? 0} />
        <MiniStat icon={<AlertTriangle size={12} />} label="Pending" value={stats?.pendingAlerts ?? alerts.length} />
        <MiniStat icon={<Search size={12} />} label="Confirmed" value={stats?.confirmedMatches ?? 0} />
      </div>
      {alerts.length === 0 ? (
        <EmptyHint text="No pending leak detections. Enroll assets in the monitoring engine." />
      ) : (
        <ul className="space-y-1.5">
          {alerts.slice(0, 3).map((a) => (
            <li key={a.id} className="text-2xs rounded px-2 py-1.5 bg-amber-500/5 border border-amber-500/20">
              <span className="text-white font-medium">{a.filename}</span>
              <span className="text-gray-500"> · {a.matchType} · {Math.round(a.similarity <= 1 ? a.similarity * 100 : a.similarity)}%</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function ReportsSnapshot({ reportCount }: { reportCount: number }) {
  return (
    <SectionCard
      title="Reports"
      icon={<BarChart2 size={16} className="text-purple-400" />}
      action={
        <Link to="/reports" className="text-2xs text-dna-400 hover:text-dna-300 flex items-center gap-1">
          All reports <ChevronRight size={12} />
        </Link>
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-2xl font-bold text-white tabular-nums">{reportCount}</p>
          <p className="text-2xs text-gray-500">Forensic & investigation reports</p>
        </div>
        <div className="text-2xs text-gray-500 space-y-1">
          <p>· Investigation summaries</p>
          <p>· Monitoring evidence</p>
          <p>· Certificate exports</p>
          <p>· Download audit trails</p>
        </div>
      </div>
      <Link
        to="/reports"
        className="mt-3 inline-flex items-center gap-1 text-xs text-dna-400 hover:text-dna-300"
      >
        <FileText size={14} />
        View organization reports
      </Link>
    </SectionCard>
  );
}

export function CertificatesSnapshot({ count, recent }: { count: number; recent: { id: string; label: string; ago: string }[] }) {
  return (
    <SectionCard
      title="Certificates"
      icon={<Award size={16} className="text-rose-400" />}
      action={
        <Link to="/certificates" className="text-2xs text-dna-400 hover:text-dna-300 flex items-center gap-1">
          Certificate manager <ChevronRight size={12} />
        </Link>
      }
    >
      <p className="text-2xl font-bold text-white mb-2 tabular-nums">{count}</p>
      <p className="text-2xs text-gray-500 mb-3">Organization ownership certificates issued</p>
      {recent.length === 0 ? (
        <EmptyHint text="Issue certificates from vaulted assets to prove ownership." />
      ) : (
        <ul className="space-y-1.5">
          {recent.map((c) => (
            <li key={c.id} className="text-2xs flex justify-between gap-2 rounded px-2 py-1 bg-bg-elevated/40">
              <span className="text-gray-300 font-mono truncate">{c.label}</span>
              <span className="text-gray-600 shrink-0">{c.ago}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ─── 11. Quick Actions ────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { to: '/generate', icon: Dna, label: 'Generate DNA', accent: 'bg-dna-500/15 text-dna-300 border-dna-500/25' },
  { to: '/generate', icon: Upload, label: 'Upload Asset', accent: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' },
  { to: BRAND.investigationPath, icon: FileSearch, label: 'Start Investigation', accent: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25' },
  { to: '/business/settings', icon: UserPlus, label: 'Invite Member', accent: 'bg-purple-500/15 text-purple-300 border-purple-500/25' },
  { to: '/vault', icon: Share2, label: 'Share Asset', accent: 'bg-blue-500/15 text-blue-300 border-blue-500/25' },
  { to: '/certificates', icon: Award, label: 'Generate Certificate', accent: 'bg-rose-500/15 text-rose-300 border-rose-500/25' },
  { to: '/monitoring', icon: Radio, label: 'Run Monitoring', accent: 'bg-amber-500/15 text-amber-300 border-amber-500/25' },
] as const;

export function QuickActionsBar() {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
      {QUICK_ACTIONS.map(({ to, icon: Icon, label, accent }) => (
        <Link
          key={label}
          to={to}
          className={cn(
            'inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors hover:brightness-110',
            accent,
          )}
        >
          <Icon size={14} />
          {label}
        </Link>
      ))}
    </div>
  );
}

// ─── 12. Team Snapshot ────────────────────────────────────────────────────────

export function TeamSnapshotPanel({
  ownerName,
  teamDisplay,
  planCode,
}: {
  ownerName: string;
  teamDisplay: string;
  planCode: string;
}) {
  const roles = [
    { role: 'Owner', icon: Crown, count: 1, names: ownerName, active: true },
    { role: 'Managers', icon: Briefcase, count: 0, names: '—', active: false },
    { role: 'Investigators', icon: FileSearch, count: 0, names: '—', active: false },
    { role: 'Members', icon: Users, count: 0, names: '—', active: false },
  ];

  return (
    <SectionCard
      title="Team Snapshot"
      icon={<Users size={16} className="text-purple-400" />}
      action={
        planCode === 'FREE' ? (
          <Link to="/upgrade" className="text-2xs text-amber-400 hover:text-amber-300">
            Upgrade for teams
          </Link>
        ) : (
          <Link to="/business/settings" className="text-2xs text-dna-400 hover:text-dna-300">
            Manage team
          </Link>
        )
      }
    >
      <p className="text-2xs text-gray-500 mb-3">
        Organization capacity: {teamDisplay} · Pending invitations: 0
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {roles.map(({ role, icon: Icon, count, names, active }) => (
          <div
            key={role}
            className={cn(
              'rounded-lg border px-3 py-2.5',
              active ? 'border-purple-500/30 bg-purple-500/5' : 'border-bg-border bg-bg-elevated/30 opacity-70',
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon size={14} className={active ? 'text-purple-400' : 'text-gray-600'} />
              <span className="text-xs font-semibold text-white">{role}</span>
              <span className="text-2xs text-gray-500 ml-auto">{count}</span>
            </div>
            <p className="text-2xs text-gray-500 truncate">{names}</p>
          </div>
        ))}
      </div>
      {planCode === 'FREE' && (
        <p className="text-2xs text-gray-600 mt-3 flex items-center gap-1">
          <KeyRound size={12} />
          Pro & Enterprise unlock multi-user RBAC, departments, and pending invitation workflows.
        </p>
      )}
    </SectionCard>
  );
}

export function OpsDashboardHeader({
  orgName,
  workspaceLabel,
  orgShortId,
  planName,
  userName,
  displayName,
  refreshing,
  onRefresh,
}: {
  orgName: string;
  workspaceLabel: string;
  orgShortId?: string;
  planName: string;
  userName: string;
  /** Full profile name for the meta line (falls back to userName). */
  displayName?: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const welcomeName = (userName || displayName || 'there').trim().split(/\s+/)[0] || 'there';
  const profileLabel = (displayName || userName || '').trim();

  return (
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
      <div>
        <div className="inline-flex items-center gap-2 text-dna-400 text-xs font-semibold uppercase tracking-wider mb-1">
          <Building2 size={14} />
          Organization home
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white">
          {greeting}, {welcomeName}
        </h1>
        <p className="text-sm text-gray-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {profileLabel && profileLabel.toLowerCase() !== 'there' && (
            <>
              <span className="text-white font-medium">{profileLabel}</span>
              <span className="text-gray-600">·</span>
            </>
          )}
          <span className="text-white/90 font-medium">{orgName}</span>
          <span className="text-gray-600">·</span>
          <span>{workspaceLabel}</span>
          {orgShortId && (
            <>
              <span className="text-gray-600">·</span>
              <span className="font-mono text-dna-400/80">{orgShortId}</span>
            </>
          )}
          <span className="text-gray-600">·</span>
          <span className="px-2 py-0.5 rounded-full bg-bg-elevated border border-bg-border text-2xs">{planName}</span>
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-bg-border text-xs text-gray-300 hover:bg-bg-elevated disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
        <Link
          to="/business/settings"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-bg-border text-xs text-gray-300 hover:bg-bg-elevated"
        >
          Settings
        </Link>
        <Link
          to="/subscription"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-dna-500/15 border border-dna-500/30 text-xs text-dna-300 hover:bg-dna-500/25"
        >
          Billing
        </Link>
      </div>
    </div>
  );
}
