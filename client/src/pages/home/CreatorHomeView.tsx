import { Children, useRef, type PointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive, AlertTriangle, RefreshCw, Globe, Plus, Link2, Radio,
  FileText, Briefcase, Shield, Share2, ChevronRight, ChevronLeft, Search,
  Lock, Folder, Database, Network, Dna, FingerprintPattern, Eye, BadgeCheck,
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

export type HomeSavedPortfolio = {
  title: string;
  status: string;
  viewUrl: string;
  photoUrl?: string;
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

function HubOrExternalLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  if (to.startsWith('/')) {
    return <Link to={to} className={className}>{children}</Link>;
  }
  return <a href={to} target="_blank" rel="noreferrer" className={className}>{children}</a>;
}

const DNA_LEGEND = [
  { icon: FingerprintPattern, label: 'Identity' },
  { icon: Shield, label: 'Provenance' },
  { icon: Eye, label: 'Usage Tracking' },
  { icon: Lock, label: 'Tamper Detection' },
  { icon: BadgeCheck, label: 'Ownership Proof' },
] as const;

/** Decorative Asset DNA artwork for the home hero. The helix is the extracted
 * reference illustration; motion is CSS-only. Carries no dashboard data. */
function AssetDnaHeroVisual() {
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 10;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 7;
    event.currentTarget.style.setProperty('--dna-px', `${x.toFixed(2)}px`);
    event.currentTarget.style.setProperty('--dna-py', `${y.toFixed(2)}px`);
  };
  const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty('--dna-px', '0px');
    event.currentTarget.style.setProperty('--dna-py', '0px');
  };

  return (
    <div
      className="hub-dna-stage"
      aria-hidden="true"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className="hub-dna-visual">
        <span className="hub-dna-glow" />
        <span className="hub-dna-depth" />
        <span className="hub-dna-particle hub-dna-particle--a" />
        <span className="hub-dna-particle hub-dna-particle--b" />
        <span className="hub-dna-particle hub-dna-particle--c" />
        <span className="hub-dna-particle hub-dna-particle--d" />
        <span className="hub-dna-particle hub-dna-particle--e" />
        <div className="hub-dna-enter">
          <div className="hub-dna-shift">
            <img src="/hub-asset-dna.png" alt="" className="hub-dna-art" draggable={false} />
          </div>
        </div>
      </div>
      <div className="hub-dna-legend">
        <div className="hub-dna-legend-head">
          <span className="hub-dna-legend-mark">
            <Dna size={15} />
          </span>
          <div className="min-w-0">
            <p className="hub-dna-legend-title">Asset DNA</p>
            <p className="hub-dna-legend-copy">Every asset has a unique digital DNA</p>
          </div>
        </div>
        <ul className="hub-dna-legend-list">
          {DNA_LEGEND.map(({ icon: Icon, label }) => (
            <li key={label}>
              <Icon size={13} />
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StatCardVisual({ type }: { type: 'blue' | 'purple' | 'teal' | 'orange' }) {
  const Icon = type === 'blue'
    ? FileText
    : type === 'purple'
      ? Folder
      : type === 'teal'
        ? Database
        : Network;
  return (
    <span className={`hub-stat-visual hub-stat-visual--${type}`} aria-hidden="true">
      <span className="hub-stat-visual-glow" />
      <span className="hub-stat-visual-shape hub-stat-visual-shape--back" />
      <span className="hub-stat-visual-shape hub-stat-visual-shape--front">
        <Icon size={22} />
      </span>
      {type === 'orange' && (
        <>
          <span className="hub-stat-node hub-stat-node--one" />
          <span className="hub-stat-node hub-stat-node--two" />
          <span className="hub-stat-node hub-stat-node--three" />
        </>
      )}
    </span>
  );
}

const MODULE_ICON_STYLE = ['hub-feature-icon--blue', 'hub-feature-icon--teal', 'hub-feature-icon--purple', 'hub-feature-icon--indigo'];
function moduleIcon(title: string) {
  if (title === 'Monitoring') return Radio;
  if (title === 'Evidence') return FileText;
  if (title === 'Intelligence') return Search;
  return Briefcase;
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
  savedPortfolio?: HomeSavedPortfolio | null;
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
  savedPortfolio = null,
  monitoringMatches,
  evidenceCount,
  trackingPoints,
  trackingRecent,
  trackingTotal,
  geoLine,
  onOpenExchange,
  kicker = 'Home',
  lede = 'Pinit HUB protects creative assets, keeps originals secure, lets you share them, tracks access, monitors usage, helps investigate matches, and preserves evidence.',
  projectStatLabel = 'Projects',
  extraQuickActions,
  workspaceModules,
  portfolioSectionTitle = 'Portfolio',
  portfolioSectionTo = '/profile?tab=portfolio',
  portfolioItemLabel = 'Portfolio items',
  children,
}: Props) {
  const hour = new Date().getHours();
  const hello = greetingForHour(hour);
  const displayName = greetingName
    || (isRealDisplayName(profile?.fullName) ? profile!.fullName.trim() : null);
  const avatar = profile?.avatarUrl;
  const recentAssets = vaultRecords.slice(0, 6);
  const shareHref = recentAssets[0]
    ? `/vault/assets/${encodeURIComponent(recentAssets[0].id)}/share`
    : '/vault';
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
  const recentRowRef = useRef<HTMLDivElement>(null);
  const scrollRecent = (dir: number) => {
    const el = recentRowRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 240), behavior: 'smooth' });
  };
  const q = activityQuery.trim().toLowerCase();
  const filteredActivity = activity.filter((ev) => {
    if (!homeActivityFilter(ev, activityFilter)) return false;
    if (!q) return true;
    const hum = humanizeHomeActivity(ev);
    return `${hum.title} ${hum.subtitle} ${ev.detail}`.toLowerCase().includes(q);
  });

  return (
    <div className="hub-home w-full relative">
      <div className="relative z-10 hub-home-stagger space-y-3 pb-6">
      <section className="relative">
        <div className="hub-home-hero-back" aria-hidden />
        <div className="hub-home-panel hub-home-hero overflow-hidden px-4 pt-4 pb-7 sm:px-5 sm:pt-5 sm:pb-5">
        <span className="hub-home-hero-aurora" aria-hidden="true" />
        <span className="hub-home-hero-grid" aria-hidden="true" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="hub-home-avatar w-11 h-11 sm:w-12 sm:h-12 rounded-xl overflow-hidden bg-dna-500 shrink-0 ring-1 ring-black/5 dark:ring-white/10">
              {avatar ? (
                <img src={avatar} alt={displayName ? `${displayName} profile photo` : 'Profile photo'} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-base font-semibold text-white" aria-hidden>
                  {initialsFrom(displayName || 'P')}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="hub-home-kicker mb-0.5">{kicker}</p>
              <h1 className="hub-home-hero-title">
                {hello}{displayName ? `, ${displayName}` : ''}
              </h1>
              <p className="hub-home-lede mt-1">
                {lede}
              </p>
              <div className="hub-home-journey hub-home-journey--tight" aria-label="Your asset journey">
                <p className="hub-home-journey-label">Your asset journey</p>
                <p className="hub-home-journey-line">
                  Protect → Store → Share → Track → Monitor → Understand → Prove
                </p>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Link to="/generate" className="btn btn-primary btn-sm gap-2">
                  <Plus size={14} /> Protect New
                </Link>
                <button type="button" onClick={onRefresh} disabled={refreshing} className="btn btn-secondary btn-sm gap-2" aria-label="Refresh home">
                  <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>
            </div>
          </div>
          <AssetDnaHeroVisual />
        </div>
        </div>
        <div className="relative z-20 -mt-4 sm:-mt-5 px-1 sm:px-2">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            {loadingStats ? (
              <p className="hub-home-meta col-span-2 lg:col-span-4">Loading your workspace…</p>
            ) : (
              <>
                <div className="hub-home-stat hub-metric-tile hub-metric-tile--blue text-left">
                  <StatCardVisual type="blue" />
                  <span className="hub-icon-raised w-7 h-7 rounded-md flex items-center justify-center text-dna-600 shrink-0 mb-1.5">
                    <Archive size={14} />
                  </span>
                  <p className="hub-home-metric tabular-nums">{protectedCount}</p>
                  <p className="hub-home-meta mt-0.5">Protected assets</p>
                </div>
                <div className="hub-home-stat hub-metric-tile hub-metric-tile--purple text-left">
                  <StatCardVisual type="purple" />
                  <span className="hub-icon-raised w-7 h-7 rounded-md flex items-center justify-center text-purple-600 shrink-0 mb-1.5">
                    <Briefcase size={14} />
                  </span>
                  <p className="hub-home-metric tabular-nums">{projectCount}</p>
                  <p className="hub-home-meta mt-0.5">{projectStatLabel}</p>
                </div>
                <div className="hub-home-stat hub-metric-tile hub-metric-tile--teal text-left">
                  <StatCardVisual type="teal" />
                  <span className="hub-icon-raised w-7 h-7 rounded-md flex items-center justify-center text-teal-600 shrink-0 mb-1.5">
                    <FileText size={14} />
                  </span>
                  <p className="hub-home-metric tabular-nums">{portfolioItemCount}</p>
                  <p className="hub-home-meta mt-0.5">{portfolioItemLabel}</p>
                </div>
                <div className="hub-home-stat hub-metric-tile hub-metric-tile--orange text-left">
                  <StatCardVisual type="orange" />
                  <span className="hub-icon-raised w-7 h-7 rounded-md flex items-center justify-center text-orange-600 shrink-0 mb-1.5">
                    <Share2 size={14} />
                  </span>
                  <p className="hub-home-metric tabular-nums">{activeShareCount}</p>
                  <p className="hub-home-meta mt-0.5">Active shares</p>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 items-start">
        <div className="contents lg:flex lg:flex-col lg:gap-3 lg:col-span-2 lg:min-w-0">
        <div className="order-1 lg:order-none hub-home-block hub-deck p-3 sm:p-4 space-y-3 min-w-0">
          <div>
            <p className="hub-home-kicker mb-2">Quick actions</p>
            <div className="grid grid-cols-2 gap-2">
              <Link to="/generate" className="btn btn-primary justify-center gap-2 min-h-[40px]">
                <Plus size={15} /> Protect New
              </Link>
              <Link to="/vault" className="btn btn-secondary justify-center gap-2 min-h-[40px]">
                <Archive size={15} /> My Assets
              </Link>
              <Link to={shareHref} className="btn btn-secondary justify-center gap-2 min-h-[40px]">
                <Link2 size={15} /> Share link
              </Link>
              <Link to="/monitoring" className="btn btn-secondary justify-center gap-2 min-h-[40px]">
                <Radio size={15} /> Monitoring
              </Link>
              {extraQuickActions}
            </div>
          </div>

          {modules.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {modules.map((mod, i) => {
                const Icon = moduleIcon(mod.title);
                return (
                  <Link
                    key={`${mod.title}-${mod.to}`}
                    to={mod.to}
                    className={`hub-home-panel hub-tile hub-tile--${i % 4} hub-interactive p-2.5 hover:ring-1 hover:ring-dna-500/25 group`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`hub-icon-raised ${MODULE_ICON_STYLE[i % MODULE_ICON_STYLE.length]} w-8 h-8 rounded-lg flex items-center justify-center shrink-0`}>
                        <Icon size={15} />
                      </span>
                      <ChevronRight size={15} className="text-slate-400 group-hover:text-dna-500 shrink-0 mt-1 transition-transform duration-200 group-hover:translate-x-1" />
                    </div>
                    <p className="hub-home-card-title mt-1.5">{mod.title}</p>
                    <p className="hub-home-meta mt-0.5">{mod.detail}</p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-3 lg:col-span-3 lg:min-w-0">
        <section className="order-2 lg:order-none hub-home-block min-w-0">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="hub-home-section">Recent assets</h2>
            <Link to="/vault" className="hub-home-link">My Assets</Link>
          </div>
          {recentAssets.length === 0 ? (
            <div className="hub-well px-2 py-7 text-center">
              <div className="hub-icon-raised mx-auto mb-3 w-14 h-14 rounded-2xl text-dna-500 flex items-center justify-center" aria-hidden>
                <Archive size={24} />
              </div>
              <p className="hub-home-body">No assets yet.</p>
              <p className="hub-home-meta mt-1">Protect your first asset to start building your protected library.</p>
              <Link to="/generate" className="btn btn-primary btn-sm mt-3 inline-flex gap-2">
                <Plus size={14} /> Protect New
              </Link>
            </div>
          ) : (
            <div className="relative">
              <button
                type="button"
                onClick={() => scrollRecent(-1)}
                aria-label="Scroll recent assets left"
                className="hub-scroll-btn hidden sm:flex absolute left-1 top-[38%] -translate-y-1/2 z-10"
              >
                <ChevronLeft size={18} />
              </button>
              <div ref={recentRowRef} className="hub-hscroll flex gap-3 overflow-x-auto py-1 sm:px-10 snap-x">
                {recentAssets.map((record) => (
                  <Link
                    key={record.id}
                    to={`/vault?id=${encodeURIComponent(record.id)}`}
                    className="hub-home-panel hub-interactive group overflow-hidden hover:ring-1 hover:ring-dna-500/25 w-[220px] sm:w-[240px] shrink-0 snap-start"
                  >
                    <div className="aspect-[4/3] bg-bg-muted overflow-hidden">
                      <VaultFileThumbnail
                        vaultId={record.id}
                        fileName={record.originalFileName}
                        mimeType={record.originalMimeType}
                        variant="gallery"
                      />
                    </div>
                    <div className="p-3">
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
              <button
                type="button"
                onClick={() => scrollRecent(1)}
                aria-label="Scroll recent assets right"
                className="hub-scroll-btn hidden sm:flex absolute right-1 top-[38%] -translate-y-1/2 z-10"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </section>
        {Children.count(children) === 1 && (
          <div className="order-4 lg:order-none min-w-0">
            {children}
          </div>
        )}
        </div>
      </div>

      {Children.count(children) > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          {children}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch">
        <section className="hub-home-block min-w-0 h-full flex flex-col">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="hub-home-section">{portfolioSectionTitle}</h2>
              {savedPortfolio?.viewUrl ? (
                <HubOrExternalLink to={savedPortfolio.viewUrl} className="hub-home-link">
                  View {portfolioSectionTitle}
                </HubOrExternalLink>
              ) : null}
            </div>
            {!savedPortfolio ? (
              <div className="hub-well p-5 flex-1">
                <div className="hub-icon-raised mb-3 w-12 h-12 rounded-2xl text-dna-500 flex items-center justify-center" aria-hidden>
                  <Briefcase size={21} />
                </div>
                <p className="hub-home-body">No saved portfolio yet.</p>
                <p className="hub-home-meta mt-1">Create and save a portfolio to see it here — this box is not a list of protected assets.</p>
                <Link to="/profile?tab=portfolio" className="btn btn-secondary btn-sm mt-3 inline-flex">
                  Create portfolio
                </Link>
              </div>
            ) : (
              <HubOrExternalLink
                to={savedPortfolio.viewUrl}
                className="hub-home-panel hub-interactive overflow-hidden group flex flex-1 items-stretch w-full"
              >
                <div className="w-24 sm:w-32 shrink-0 bg-bg-muted overflow-hidden">
                  {savedPortfolio.photoUrl ? (
                    <img src={savedPortfolio.photoUrl} alt="" className="w-full h-full object-cover min-h-[96px]" />
                  ) : (
                    <div className="w-full min-h-[96px] h-full flex items-center justify-center text-slate-400">
                      <Briefcase size={22} />
                    </div>
                  )}
                </div>
                <div className="p-3 min-w-0 flex-1 flex flex-col justify-center">
                  <p className="hub-home-card-title truncate">{savedPortfolio.title}</p>
                  <p className="hub-home-meta mt-1">{savedPortfolio.status}</p>
                </div>
              </HubOrExternalLink>
            )}
        </section>

        <section className="hub-home-block hub-panel-analytics min-w-0">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="hub-home-section">Recent activity</h2>
              <Link to="/timeline" className="hub-home-link">All activity</Link>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
              <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
                <div className="flex flex-nowrap items-center gap-1.5 w-max">
                  {ACTIVITY_FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => onActivityFilter(f.id)}
                      className={`hub-chip text-[13px] font-medium px-3.5 py-1.5 rounded-full min-h-[40px] sm:min-h-0 whitespace-nowrap shrink-0 ${
                        activityFilter === f.id
                          ? 'hub-chip-active dark:bg-dna-500/20 dark:text-blue-200 dark:border-dna-500/40'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:border-white/20 dark:hover:text-white'
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
                <div className="hub-well py-6 text-center">
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

        <section className="hub-home-block hub-panel-status lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="hub-home-section">Needs your attention</h2>
            <Link to="/profile?tab=notifications" className="hub-home-link">
              Notifications
            </Link>
          </div>
          {attentionLoading ? (
            <div className="skeleton h-12 rounded-xl" />
          ) : attention.length === 0 ? (
            <div className="hub-well py-5 px-4 text-center">
              <div className="hub-icon-raised mx-auto mb-3 w-12 h-12 rounded-2xl text-dna-500 flex items-center justify-center" aria-hidden>
                <Shield size={21} />
              </div>
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
      </div>

      <section className="hub-home-block hub-panel-monitor">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Globe size={16} className="text-dna-500" />
                <h2 className="hub-home-section">Where assets were opened</h2>
              </div>
              <Link to="/access-intelligence" className="hub-home-link">Open tracking</Link>
            </div>
            {geoLine && <p className="hub-home-meta mb-3">{geoLine}</p>}
            <div className="hub-inset relative h-[260px] sm:h-[300px] lg:h-[320px] rounded-xl overflow-hidden dark:border-white/20">
              <DashboardFilesMap points={trackingPoints} fill live premium />
            </div>
            {(trackingRecent > 0 || trackingTotal > 0) && (
              <p className="hub-home-meta mt-3">
                {trackingRecent > 0 ? `${trackingRecent} in the last hour · ` : ''}
                {trackingTotal} locations
              </p>
            )}
          </section>
      </div>
    </div>
  );
}
