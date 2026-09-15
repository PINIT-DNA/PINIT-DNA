import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive, AlertTriangle, RefreshCw, Eye, Globe, Plus, Link2, Radio,
  FileText, Briefcase, MapPin, Pencil, Shield, Share2, FileSearch, ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { VaultFileThumbnail } from '../../components/VaultFileThumbnail';
import { DashboardFilesMap, type DashboardFileMapPoint } from '../../components/maps/DashboardFilesMap';
import type { VaultRecord } from '../../types/dashboard.types';
import { getVaultFileTypeLabel } from '../../lib/file-type-utils';
import {
  greetingForHour,
  homeActivityFilter,
  humanizeHomeActivity,
  HOME_ACTIVITY_TABS,
  type HomeActivityEvent,
} from '../../lib/home-activity';
import { BRAND } from '../../config/brand.config';
import type { UserProfileSummary } from '../../hooks/useUserProfile';
import { isRealDisplayName } from '../../hooks/useUserProfile';

export type HomePortfolioGroup = {
  id: string;
  title: string;
  category: string;
  vault_ids: string[];
  href?: string;
  /** Real asset count when vault ids are not available on this surface. */
  itemCount?: number;
};

export type HomeWorkspaceModule = {
  to: string;
  title: string;
  detail: string;
};

export type HomeAttentionItem = {
  key: string;
  tone: 'warn' | 'info';
  title: string;
  strong: string;
  detail: string;
  to: string;
  action: string;
};

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'P';
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function groupItemCount(g: HomePortfolioGroup): number {
  return g.itemCount ?? g.vault_ids.length;
}

function latestVaultDate(ids: string[], vaultRecords: VaultRecord[]): Date | null {
  let latest = 0;
  for (const id of ids) {
    const rec = vaultRecords.find((v) => v.id === id);
    if (!rec) continue;
    const t = new Date(rec.createdAt).getTime();
    if (!Number.isNaN(t) && t > latest) latest = t;
  }
  return latest ? new Date(latest) : null;
}

function activityIcon(type: string) {
  if (type === 'SHARE_CREATED' || type.startsWith('ACCESS_')) return Share2;
  if (type === 'EVIDENCE_CREATED') return Shield;
  if (type === 'MONITORING_MATCH' || type === 'RISK_EVENT') return AlertTriangle;
  if (type === 'PORTFOLIO_UPDATED' || type === 'PORTFOLIO_VIEWED') return Briefcase;
  return FileText;
}

const ACTIVITY_FILTERS = HOME_ACTIVITY_TABS;

interface Props {
  greetingName: string | null;
  profile: UserProfileSummary | null;
  protectedCount: number;
  projectCount: number;
  portfolioItemCount: number;
  activeShareCount: number;
  loadingStats: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  attention: HomeAttentionItem[];
  attentionLoading: boolean;
  vaultRecords: VaultRecord[];
  activity: HomeActivityEvent[];
  activityFilter: string;
  onActivityFilter: (id: string) => void;
  activityQuery: string;
  onActivityQuery: (q: string) => void;
  portfolioGroups: HomePortfolioGroup[];
  portfolioHeadline?: string;
  portfolioAbout?: string;
  portfolioLocation: string;
  monitoringEnabled: boolean | null;
  monitoringMatches: number;
  evidenceCount: number;
  suspiciousCount: number;
  trackingPoints: DashboardFileMapPoint[];
  trackingRecent: number;
  trackingTotal: number;
  geoLine: string | null;
  onOpenExchange?: () => void;
  kicker?: string;
  lede?: string;
  projectStatLabel?: string;
  extraQuickActions?: ReactNode;
  extraShortcuts?: ReactNode;
  workspaceModules?: HomeWorkspaceModule[];
  portfolioSectionTitle?: string;
  portfolioSectionTo?: string;
  portfolioItemLabel?: string;
  recentProjectsTitle?: string;
  profilePortfolioTo?: string;
  children?: ReactNode;
}

export function CreatorHomeView({
  greetingName,
  profile,
  protectedCount,
  projectCount,
  portfolioItemCount,
  activeShareCount,
  loadingStats,
  onRefresh,
  refreshing,
  attention,
  attentionLoading,
  vaultRecords,
  activity,
  activityFilter,
  onActivityFilter,
  activityQuery,
  onActivityQuery,
  portfolioGroups,
  portfolioLocation,
  monitoringEnabled,
  monitoringMatches,
  evidenceCount,
  suspiciousCount,
  trackingPoints,
  trackingRecent,
  trackingTotal,
  geoLine,
  onOpenExchange,
  kicker = 'Home',
  lede = 'Pinit HUB protects creative assets, keeps originals secure, lets you share them, tracks access, monitors usage, helps investigate matches, and preserves evidence.',
  projectStatLabel = 'Projects',
  extraQuickActions,
  extraShortcuts,
  workspaceModules,
  portfolioSectionTitle = 'Portfolio',
  portfolioSectionTo = '/profile?tab=portfolio',
  portfolioItemLabel = 'Portfolio items',
  recentProjectsTitle = 'Recent projects',
  profilePortfolioTo = '/profile?tab=portfolio',
  children,
}: Props) {
  const hour = new Date().getHours();
  const hello = greetingForHour(hour);
  const displayName = greetingName
    || (isRealDisplayName(profile?.fullName) ? profile!.fullName.trim() : null);
  const roleLine = [profile?.jobTitle, profile?.organization].filter(Boolean).join(' · ');
  const location = portfolioLocation || profile?.country || '';
  const avatar = profile?.avatarUrl;
  const recentAssets = vaultRecords.slice(0, 6);
  const shareHref = recentAssets[0]
    ? `/vault/assets/${encodeURIComponent(recentAssets[0].id)}/share`
    : '/vault';
  const featuredProjects = portfolioGroups.slice(0, 3);
  const modules = workspaceModules ?? [
    {
      to: portfolioSectionTo,
      title: portfolioSectionTitle,
      detail: projectCount === 1 ? '1 project' : `${projectCount} projects`,
    },
    {
      to: '/monitoring',
      title: 'Monitoring',
      detail: monitoringMatches === 1 ? '1 match' : `${monitoringMatches} matches`,
    },
    {
      to: '/reports',
      title: 'Evidence',
      detail: evidenceCount === 1 ? '1 report' : `${evidenceCount} reports`,
    },
    {
      to: BRAND.investigationPath,
      title: 'Intelligence',
      detail: 'Compare a file to protected work',
    },
  ];
  const q = activityQuery.trim().toLowerCase();
  const filteredActivity = activity.filter((ev) => {
    if (!homeActivityFilter(ev, activityFilter)) return false;
    if (!q) return true;
    const hum = humanizeHomeActivity(ev);
    return `${hum.title} ${hum.subtitle} ${ev.detail}`.toLowerCase().includes(q);
  });

  return (
    <div className="hub-home w-full max-w-[1400px] mx-auto animate-fade-in space-y-8 pb-10">
      <section className="hub-home-panel relative overflow-hidden px-5 py-7 sm:px-8 sm:py-8">
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start gap-5 min-w-0">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-dna-500 shrink-0 ring-1 ring-black/5 dark:ring-white/10">
              {avatar ? (
                <img src={avatar} alt={displayName ? `${displayName} profile photo` : 'Profile photo'} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xl font-semibold text-white" aria-hidden>
                  {initialsFrom(displayName || 'P')}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="hub-home-kicker mb-2">{kicker}</p>
              <h1 className="hub-home-hero-title">
                {hello}{displayName ? `, ${displayName}` : ''}
              </h1>
              <p className="hub-home-lede mt-3">
                {lede}
              </p>
              <div className="hub-home-journey" aria-label="Your asset journey">
                <p className="hub-home-journey-label">Your asset journey</p>
                <p className="hub-home-journey-line">
                  Protect → Store → Share → Track → Monitor → Understand → Prove
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link to="/generate" className="btn btn-primary btn-sm gap-2">
              <Plus size={14} /> Protect New
            </Link>
            <button type="button" onClick={onRefresh} disabled={refreshing} className="btn btn-secondary btn-sm gap-2" aria-label="Refresh home">
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
        <div className="relative mt-8 grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
          {loadingStats ? (
            <p className="hub-home-meta col-span-2 lg:col-span-4">Loading your workspace…</p>
          ) : (
            <>
              <div className="hub-home-stat">
                <p className="hub-home-metric tabular-nums">{protectedCount}</p>
                <p className="hub-home-meta mt-1">Protected assets</p>
              </div>
              <div className="hub-home-stat">
                <p className="hub-home-metric tabular-nums">{projectCount}</p>
                <p className="hub-home-meta mt-1">{projectStatLabel}</p>
              </div>
              <div className="hub-home-stat">
                <p className="hub-home-metric tabular-nums">{portfolioItemCount}</p>
                <p className="hub-home-meta mt-1">{portfolioItemLabel}</p>
              </div>
              <div className="hub-home-stat">
                <p className="hub-home-metric tabular-nums">{activeShareCount}</p>
                <p className="hub-home-meta mt-1">Active shares</p>
              </div>
            </>
          )}
        </div>
      </section>

      <div className="hub-home-block">
        <p className="hub-home-kicker mb-3">Quick actions</p>
        <div className={`grid grid-cols-2 gap-2 sm:gap-3 ${extraQuickActions ? 'sm:grid-cols-3 lg:grid-cols-4' : 'sm:grid-cols-4'}`}>
        <Link to="/generate" className="btn btn-primary justify-center gap-2 min-h-[44px]">
          <Plus size={15} /> Protect New
        </Link>
        <Link to="/vault" className="btn btn-secondary justify-center gap-2 min-h-[44px]">
          <Archive size={15} /> My Assets
        </Link>
        <Link to={shareHref} className="btn btn-secondary justify-center gap-2 min-h-[44px]">
          <Link2 size={15} /> Share link
        </Link>
        <Link to="/monitoring" className="btn btn-secondary justify-center gap-2 min-h-[44px]">
          <Radio size={15} /> Monitoring
        </Link>
        {extraQuickActions}
        </div>
      </div>

      {modules.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {modules.map((mod) => (
            <Link
              key={`${mod.title}-${mod.to}`}
              to={mod.to}
              className="hub-home-panel p-4 hover:ring-1 hover:ring-dna-500/25 transition-shadow group"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="hub-home-card-title">{mod.title}</p>
                <ChevronRight size={16} className="text-slate-400 group-hover:text-dna-500 shrink-0 mt-0.5" />
              </div>
              <p className="hub-home-meta mt-1">{mod.detail}</p>
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-8 items-start">
        <div className="space-y-8 min-w-0">
          <section className="hub-home-block">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="hub-home-section">Needs your attention</h2>
              <Link to="/profile?tab=notifications" className="hub-home-link">
                Notifications
              </Link>
            </div>
            {attentionLoading ? (
              <div className="skeleton h-12 rounded-xl" />
            ) : attention.length === 0 ? (
              <div className="py-1">
                <p className="hub-home-body">You’re all caught up.</p>
                <p className="hub-home-meta mt-1">Nothing needs your attention right now.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {attention.map((item) => (
                  <div key={item.key} className="hub-home-row flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${item.tone === 'warn' ? 'bg-amber-500/15 text-amber-500' : 'bg-dna-50 text-dna-600'}`}>
                      {item.tone === 'warn' ? <AlertTriangle size={15} /> : <Link2 size={15} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] leading-snug text-slate-700 dark:text-slate-200">
                        {item.title} <span className="font-semibold text-slate-900 dark:text-white">{item.strong}</span>
                      </p>
                      <p className="hub-home-meta mt-0.5">{item.detail}</p>
                    </div>
                    <Link to={item.to} className="btn btn-secondary btn-sm shrink-0">{item.action}</Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="hub-home-block">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="hub-home-section">Recent assets</h2>
              <Link to="/vault" className="hub-home-link">My Assets</Link>
            </div>
            {recentAssets.length === 0 ? (
              <div className="px-2 py-10 text-center">
                <p className="hub-home-body">No assets yet.</p>
                <p className="hub-home-meta mt-1">Protect your first asset to start building your protected library.</p>
                <Link to="/generate" className="btn btn-primary btn-sm mt-4 inline-flex gap-2">
                  <Plus size={14} /> Protect New
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {recentAssets.map((record) => (
                  <Link
                    key={record.id}
                    to={`/vault?id=${encodeURIComponent(record.id)}`}
                    className="hub-home-panel group overflow-hidden hover:ring-1 hover:ring-dna-500/25 transition-shadow"
                  >
                    <div className="aspect-[4/3] bg-bg-muted overflow-hidden">
                      <VaultFileThumbnail
                        vaultId={record.id}
                        fileName={record.originalFileName}
                        mimeType={record.originalMimeType}
                        variant="gallery"
                      />
                    </div>
                    <div className="p-3.5">
                      <p className="hub-home-card-title truncate">{record.originalFileName}</p>
                      <p className="hub-home-meta mt-1">
                        {getVaultFileTypeLabel(record.originalMimeType, record.originalFileName)}
                        {' · Protected'}
                        {' · '}
                        {formatDistanceToNow(new Date(record.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="hub-home-block">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="hub-home-section">{portfolioSectionTitle}</h2>
              <Link to={portfolioSectionTo} className="hub-home-link">View {portfolioSectionTitle}</Link>
            </div>
            {featuredProjects.length === 0 ? (
              <p className="hub-home-body">No {portfolioSectionTitle.toLowerCase()} yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {featuredProjects.map((g) => {
                  const coverId = g.vault_ids[0];
                  const cover = coverId ? vaultRecords.find((v) => v.id === coverId) : undefined;
                  return (
                    <Link key={g.id} to={g.href ?? portfolioSectionTo} className="hub-home-panel overflow-hidden group">
                      <div className="aspect-[16/10] bg-bg-muted overflow-hidden">
                        {cover ? (
                          <VaultFileThumbnail vaultId={cover.id} fileName={cover.originalFileName} mimeType={cover.originalMimeType} variant="gallery" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400">
                            <Briefcase size={22} />
                          </div>
                        )}
                      </div>
                      <div className="p-3.5">
                        <p className="hub-home-card-title truncate">{g.title}</p>
                        <p className="hub-home-meta mt-1">
                          {[g.category, `${groupItemCount(g)} ${groupItemCount(g) === 1 ? 'asset' : 'assets'}`].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {children}

          <section className="hub-home-block">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="hub-home-section">Recent activity</h2>
              <Link to="/timeline" className="hub-home-link">All activity</Link>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
              <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                <div className="flex flex-nowrap items-center gap-1.5 w-max">
                  {ACTIVITY_FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => onActivityFilter(f.id)}
                      className={`text-[13px] font-medium px-3 py-1.5 rounded-full min-h-[40px] sm:min-h-0 whitespace-nowrap shrink-0 transition-colors ${
                        activityFilter === f.id
                          ? 'bg-dna-50 text-dna-700 border border-dna-200 dark:bg-dna-500/20 dark:text-blue-200 dark:border-dna-500/40'
                          : 'text-slate-600 border border-slate-200 hover:text-slate-900 hover:border-slate-300 dark:text-slate-300 dark:border-white/20 dark:hover:text-white'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <input
                value={activityQuery}
                onChange={(e) => onActivityQuery(e.target.value)}
                placeholder="Search activity…"
                aria-label="Search activity"
                className="input text-sm h-10 w-full sm:w-52 shrink-0"
              />
            </div>
            <div className="space-y-2">
              {filteredActivity.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="hub-home-body">{ACTIVITY_FILTERS.find((t) => t.id === activityFilter)?.empty ?? 'No activity yet.'}</p>
                  {activityFilter === 'exchange' && onOpenExchange ? (
                    <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={onOpenExchange}>
                      Open Exchange
                    </button>
                  ) : ACTIVITY_FILTERS.find((t) => t.id === activityFilter)?.moreTo ? (
                    <Link to={ACTIVITY_FILTERS.find((t) => t.id === activityFilter)!.moreTo!} className="btn btn-secondary btn-sm mt-3 inline-flex">
                      {ACTIVITY_FILTERS.find((t) => t.id === activityFilter)?.moreLabel}
                    </Link>
                  ) : null}
                </div>
              ) : (
                filteredActivity.slice(0, 4).map((ev) => {
                  const hum = humanizeHomeActivity(ev);
                  const Icon = activityIcon(ev.type);
                  const inner = (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-dna-50 text-dna-600 dark:bg-dna-500/15 dark:text-blue-300 flex items-center justify-center shrink-0">
                        <Icon size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="hub-home-card-title">{hum.title}</p>
                        <p className="hub-home-meta mt-0.5">{hum.subtitle}</p>
                      </div>
                      <p className="hub-home-meta shrink-0">
                        {formatDistanceToNow(new Date(ev.date), { addSuffix: true })}
                      </p>
                    </>
                  );
                  return ev.href ? (
                    <Link
                      key={ev.id}
                      to={ev.href}
                      className="flex items-start gap-3 px-3 py-3 hub-home-row hover:border-dna-400/40"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={ev.id} className="flex items-start gap-3 px-3 py-3 hub-home-row">
                      {inner}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="hub-home-block">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Globe size={16} className="text-dna-500" />
                <h2 className="hub-home-section">Where assets were opened</h2>
              </div>
              <Link to="/access-intelligence" className="hub-home-link">Open tracking</Link>
            </div>
            {geoLine && <p className="hub-home-meta mb-3">{geoLine}</p>}
            <div className="relative h-[220px] rounded-xl overflow-hidden border border-slate-200 dark:border-white/20">
              <DashboardFilesMap points={trackingPoints} fill live />
            </div>
            {(trackingRecent > 0 || trackingTotal > 0) && (
              <p className="hub-home-meta mt-3">
                {trackingRecent > 0 ? `${trackingRecent} in the last hour · ` : ''}
                {trackingTotal} locations
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-20">
          <div className="hub-home-panel p-5">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-dna-500 shrink-0">
                {avatar ? (
                  <img src={avatar} alt={displayName ? `${displayName} profile photo` : 'Profile photo'} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-sm font-semibold text-white" aria-hidden>
                    {initialsFrom(displayName || 'P')}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="hub-home-card-title truncate">{displayName || 'Your profile'}</p>
                {roleLine && <p className="hub-home-meta mt-0.5">{roleLine}</p>}
                {location && (
                  <p className="hub-home-meta mt-1 flex items-center gap-1">
                    <MapPin size={12} /> {location}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Link to={profilePortfolioTo} className="btn btn-secondary btn-sm flex-1 justify-center">{portfolioSectionTitle}</Link>
              <Link to="/profile?tab=profile" className="btn btn-primary btn-sm flex-1 justify-center gap-1">
                <Pencil size={12} /> Edit profile
              </Link>
            </div>
          </div>

          <div className="hub-home-block">
            <p className="hub-home-kicker mb-3">Shortcuts</p>
            <div className="flex flex-col gap-2">
              <Link to={shareHref} className="hub-home-link">Share a protected file</Link>
              <Link to={portfolioSectionTo} className="hub-home-link">{portfolioSectionTitle}</Link>
              <Link to="/monitoring" className="hub-home-link">Monitoring</Link>
              <Link to="/reports" className="hub-home-link">Evidence</Link>
              <Link to={BRAND.investigationPath} className="hub-home-link">Intelligence</Link>
              {extraShortcuts}
            </div>
          </div>

          <div className="hub-home-block">
            <div className="flex items-center justify-between mb-3">
              <h3 className="hub-home-section text-[18px]">{recentProjectsTitle}</h3>
              <Link to={portfolioSectionTo} className="hub-home-link">View</Link>
            </div>
            {portfolioGroups.length === 0 ? (
              <p className="hub-home-meta">No {portfolioSectionTitle.toLowerCase()} yet.</p>
            ) : (
              <ul className="space-y-3">
                {portfolioGroups.slice(0, 4).map((g) => {
                  const coverId = g.vault_ids[0];
                  const cover = coverId ? vaultRecords.find((v) => v.id === coverId) : undefined;
                  const updated = latestVaultDate(g.vault_ids, vaultRecords);
                  return (
                    <li key={g.id}>
                      <Link to={g.href ?? portfolioSectionTo} className="flex items-center gap-3 rounded-xl p-1 -mx-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                        <div className="w-14 h-14 rounded-xl overflow-hidden bg-bg-muted shrink-0">
                          {cover ? (
                            <VaultFileThumbnail vaultId={cover.id} fileName={cover.originalFileName} mimeType={cover.originalMimeType} variant="compact" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400"><Briefcase size={16} /></div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="hub-home-card-title truncate">{g.title}</p>
                          <p className="hub-home-meta mt-0.5">
                            {[g.category, `${groupItemCount(g)} ${groupItemCount(g) === 1 ? 'asset' : 'assets'}`].filter(Boolean).join(' · ')}
                            {updated ? ` · ${formatDistanceToNow(updated, { addSuffix: true })}` : ''}
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="hub-home-block">
            <h3 className="hub-home-section text-[18px] mb-3">Protection</h3>
            <ul className="space-y-2.5">
              <li className="flex items-center justify-between gap-2">
                <Link to="/vault" className="hub-home-meta flex items-center gap-2 hover:text-dna-500"><Archive size={14} /> My Assets</Link>
                <span className="hub-home-card-title tabular-nums">{protectedCount}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <Link to={BRAND.investigationPath} className="hub-home-meta flex items-center gap-2 hover:text-dna-500"><FileSearch size={14} /> Intelligence</Link>
              </li>
              <li className="flex items-center justify-between gap-2">
                <Link to="/reports" className="hub-home-meta flex items-center gap-2 hover:text-dna-500"><Shield size={14} /> Evidence</Link>
                <span className="hub-home-card-title tabular-nums">{evidenceCount}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <Link to="/monitoring" className="hub-home-meta flex items-center gap-2 hover:text-dna-500"><Radio size={14} /> Monitoring</Link>
                <span className="hub-home-card-title">
                  {monitoringEnabled === null ? '—' : monitoringEnabled ? 'On' : 'Paused'}
                </span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <Link to="/monitoring" className="hub-home-meta flex items-center gap-2 hover:text-dna-500"><Eye size={14} /> Matches</Link>
                <span className="hub-home-card-title tabular-nums">{monitoringMatches}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <Link to="/access-intelligence" className="hub-home-meta flex items-center gap-2 hover:text-dna-500"><AlertTriangle size={14} /> Suspicious activity</Link>
                <span className="hub-home-card-title tabular-nums">{suspiciousCount}</span>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
