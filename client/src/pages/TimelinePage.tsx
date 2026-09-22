/**
 * Asset Activity — one protected file, one unbroken log.
 * Route: /timeline
 *
 * This used to list DNA records, so the same file appeared once per protection
 * run (Ocean.jpg twice, a certificate PDF three times) and the internal
 * frame-NN.jpg records made while protecting a video looked like files the owner
 * had uploaded. It now lists FILES, from the server, merged by content hash:
 * protecting the same bytes again adds a "Protected again" line to the one log
 * instead of starting a second row, and a record with no asset behind it is not
 * a row at all.
 *
 * The log itself is one continuous strip from the first protection to the last
 * thing that happened — nothing is split into separate event groups.
 *
 * Read-only. Comparison reports still come from this browser's own storage and
 * are merged into the file they belong to.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Clock, Dna, Lock, Search, GitCompare, Award,
  Shield, RefreshCw, Filter, ChevronDown, ChevronUp,
  Share2, Eye, Download, Copy, Ban, CornerDownRight,
  BadgeCheck, Globe, ShoppingBag, Archive, RotateCcw,
  Trash2, Radio, AlertTriangle, FileSearch, FileCheck, Tag,
  Heart, ShoppingCart, CheckCircle2, MessageSquare, Pencil,
} from 'lucide-react';
import { api } from '../services/dashboard.api';
import { getOwnerActivity, type ActivityFile, type ActivityEvent, type ActivityEventType } from '../services/tracking.api';
import { listForensicReports } from '../lib/forensic-reports-storage';
import { FileTypeBadge, Badge } from '../components/ui/Badge';
import { SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { cn } from '../components/ui/utils';
import { API_BASE_URL } from '../config/api.config';
import type { ComparisonResult } from '../types/dashboard.types';

// --- How each kind of event looks ---------------------------------------------

const BLUE = 'bg-info/20 border-info/40 text-info';
const GREEN = 'bg-success/20 border-success/40 text-success';
const PURPLE = 'bg-purple/20 border-purple/40 text-purple';
const ORANGE = 'bg-orange/20 border-orange/40 text-orange';
const CYAN = 'bg-cyan/20 border-cyan/40 text-cyan';
const WARN = 'bg-warning/20 border-warning/40 text-warning';
const RED = 'bg-danger/20 border-danger/40 text-danger';
const DNA_C = 'bg-dna-500/20 border-dna-500/40 text-dna-400';
const GREY = 'bg-bg-elevated border-bg-border text-gray-400';

const EVENT_STYLE: Partial<Record<ActivityEventType, { color: string; icon: React.ReactNode }>> = {
  // Hub
  PROTECTED:           { color: DNA_C,  icon: <Dna size={14} /> },
  PROTECTED_AGAIN:     { color: DNA_C,  icon: <RotateCcw size={14} /> },
  VAULT_STORED:        { color: GREEN,  icon: <Lock size={14} /> },
  VAULT_VIEWED:        { color: BLUE,   icon: <Eye size={14} /> },
  VAULT_DOWNLOADED:    { color: GREEN,  icon: <Download size={14} /> },
  VAULT_ISSUE:         { color: WARN,   icon: <AlertTriangle size={14} /> },
  RENAMED:             { color: GREY,   icon: <Pencil size={14} /> },
  DELETED:             { color: RED,    icon: <Trash2 size={14} /> },
  ARCHIVED:            { color: GREY,   icon: <Archive size={14} /> },
  // Certificate
  CERTIFICATE_ISSUED:  { color: PURPLE, icon: <Award size={14} /> },
  CERTIFICATE_CHECKED: { color: PURPLE, icon: <BadgeCheck size={14} /> },
  CERTIFICATE_REVOKED: { color: RED,    icon: <Ban size={14} /> },
  CERTIFICATE_EXPIRED: { color: WARN,   icon: <Clock size={14} /> },
  // Portfolio
  PORTFOLIO_ADDED:     { color: CYAN,   icon: <Globe size={14} /> },
  PORTFOLIO_PUBLISHED: { color: CYAN,   icon: <Globe size={14} /> },
  PORTFOLIO_VIEWED:    { color: BLUE,   icon: <Eye size={14} /> },
  // Sharing
  SHARE_CREATED:       { color: ORANGE, icon: <Share2 size={14} /> },
  SHARE_FORWARDED:     { color: ORANGE, icon: <CornerDownRight size={14} /> },
  SHARE_VIEWED:        { color: BLUE,   icon: <Eye size={14} /> },
  SHARE_DOWNLOADED:    { color: GREEN,  icon: <Download size={14} /> },
  SHARE_COPIED:        { color: CYAN,   icon: <Copy size={14} /> },
  SHARE_SCREENSHOT:    { color: WARN,   icon: <Ban size={14} /> },
  SHARE_STOPPED:       { color: RED,    icon: <Ban size={14} /> },
  SHARE_EXPIRED:       { color: GREY,   icon: <Clock size={14} /> },
  SHARE_RISK:          { color: WARN,   icon: <AlertTriangle size={14} /> },
  // Exchange
  EXCHANGE_LIST_STARTED: { color: ORANGE, icon: <Tag size={14} /> },
  EXCHANGE_LISTED:     { color: ORANGE, icon: <Tag size={14} /> },
  EXCHANGE_UNLISTED:   { color: GREY,   icon: <Tag size={14} /> },
  EXCHANGE_VIEWED:     { color: BLUE,   icon: <Eye size={14} /> },
  SOLD:                { color: ORANGE, icon: <ShoppingBag size={14} /> },
  CART_ADDED:          { color: GREY,   icon: <ShoppingCart size={14} /> },
  WISHLIST_ADDED:      { color: GREY,   icon: <Heart size={14} /> },
  // Monitoring, investigation, evidence
  MONITORING_STARTED:  { color: CYAN,   icon: <Radio size={14} /> },
  FOUND_ONLINE:        { color: RED,    icon: <Globe size={14} /> },
  TAMPERING:           { color: RED,    icon: <AlertTriangle size={14} /> },
  DUPLICATE_BLOCKED:   { color: WARN,   icon: <Shield size={14} /> },
  INVESTIGATION_STARTED:   { color: CYAN, icon: <FileSearch size={14} /> },
  INVESTIGATION_COMPLETED: { color: CYAN, icon: <FileCheck size={14} /> },
  EVIDENCE_CREATED:    { color: PURPLE, icon: <FileCheck size={14} /> },
  // Review and notes
  VERSION_APPROVED:    { color: GREEN,  icon: <CheckCircle2 size={14} /> },
  VERSION_CHANGES:     { color: WARN,   icon: <MessageSquare size={14} /> },
  STATUS_CHANGE:       { color: GREY,   icon: <Clock size={14} /> },
  NOTE:                { color: GREY,   icon: <MessageSquare size={14} /> },
  COMPARED:            { color: CYAN,   icon: <GitCompare size={14} /> },
};

const DEFAULT_STYLE = { color: GREY, icon: <Clock size={14} /> };

/**
 * Comparison reports live in this browser, not the database, so they are merged
 * in here. They record filenames rather than record ids, which is how the old
 * screen matched them too.
 */
function comparisonEvents(file: ActivityFile, comparisons: ComparisonResult[]): ActivityEvent[] {
  const names = new Set([file.filename, ...file.otherFilenames]);
  return comparisons
    .filter((c) => names.has(c.fileA?.filename) || names.has(c.fileB?.filename))
    .map((c) => ({
      id: `compare-${c.comparisonId}-${file.key}`,
      at: c.comparedAt ?? file.lastActivityAt,
      type: 'COMPARED' as const,
      title: `Compared with another file · ${c.classification.replace('_', ' ')}`,
      detail: `${c.overallConfidenceScore}% confidence · ${c.tamperingDetected ? 'tampering detected' : 'no tampering'}`,
      meta: {
        'Comparison ID': c.comparisonId.slice(0, 12),
        Classification: c.classification,
        Confidence: `${c.overallConfidenceScore}%`,
      },
    }));
}

// --- One file, one log --------------------------------------------------------

function FileLogCard({
  file,
  events,
  expanded,
  onToggle,
}: {
  file: ActivityFile;
  events: ActivityEvent[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="card overflow-hidden p-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-bg-elevated/40 transition-colors"
      >
        <FileTypeBadge type={file.assetType} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{file.filename}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {events.length} {events.length === 1 ? 'event' : 'events'} · from{' '}
            {format(new Date(file.protectedAt), 'd MMM yyyy')}
            {file.timesProtected > 1 && ` · protected ${file.timesProtected} times`}
            {file.otherFilenames.length > 0 && ` · also saved as ${file.otherFilenames.join(', ')}`}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1">
            {file.deleted
              ? <Badge variant="danger">Deleted</Badge>
              : events.some((e) => e.type === 'VAULT_STORED') && <Badge variant="success">In vault</Badge>}
            {file.certificateId && <Badge variant="purple">Certificate</Badge>}
            {events.some((e) => e.type === 'SOLD') && <Badge variant="orange">Sold</Badge>}
            {events.some((e) => e.type === 'FOUND_ONLINE') && <Badge variant="danger">Found online</Badge>}
            {events.some((e) => e.type === 'PORTFOLIO_ADDED') && <Badge variant="cyan">Portfolio</Badge>}
          </div>
          <span className="text-xs text-gray-500">
            {formatDistanceToNow(new Date(file.lastActivityAt), { addSuffix: true })}
          </span>
          <span
            role="link"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/tracking/${encodeURIComponent(file.assetId)}`);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                navigate(`/tracking/${encodeURIComponent(file.assetId)}`);
              }
            }}
            className="text-xs font-semibold text-dna-600 dark:text-blue-300 hover:underline"
          >
            Open asset
          </span>
          {expanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-bg-border px-4 py-4">
          <div className="relative">
            <div className="absolute left-[18px] top-0 bottom-0 w-px bg-bg-border" />

            <div className="space-y-4">
              {events.map((event, i) => {
                const style = EVENT_STYLE[event.type] ?? DEFAULT_STYLE;
                return (
                  <div key={event.id} className="relative flex gap-3">
                    <div className={cn(
                      'relative z-10 w-9 h-9 rounded-full border flex items-center justify-center shrink-0',
                      style.color,
                    )}>
                      {style.icon}
                    </div>

                    <div className="flex-1 min-w-0 pb-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{event.title}</p>
                          <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">{event.detail}</p>
                        </div>
                        <span className="text-2xs text-gray-600 mono shrink-0 mt-0.5">
                          {format(new Date(event.at), 'MMM d, HH:mm')}
                        </span>
                      </div>

                      {event.meta && Object.keys(event.meta).length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {Object.entries(event.meta).map(([k, v]) => (
                            <div key={k} className="border rounded-lg px-2.5 py-1 bg-bg-elevated border-bg-border">
                              <span className="text-2xs text-gray-500">{k}: </span>
                              <span className="text-2xs mono text-gray-300">
                                {v.length > 60 ? `${v.slice(0, 60)}…` : v}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {event.token && (
                        <div className="flex items-center gap-3 mt-2">
                          <button
                            onClick={() => navigate(`/access-intelligence/${encodeURIComponent(event.token!)}`)}
                            className="inline-flex items-center gap-1.5 text-2xs text-dna-400 hover:text-dna-300 bg-dna-500/10 hover:bg-dna-500/20 px-2.5 py-1 rounded-lg transition-colors"
                          >
                            <Shield size={11} /> Open this link
                          </button>
                          {event.type === 'SHARE_CREATED' && (
                            <a
                              href={`${API_BASE_URL}/share/${event.token}/export`}
                              target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-2xs text-gray-500 hover:text-gray-300 underline underline-offset-2"
                            >
                              <Download size={11} /> Export CSV
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    {i < events.length - 1 && (
                      <div className="absolute left-[17px] top-9 w-2 h-2 rounded-full bg-bg-border" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Page ---------------------------------------------------------------------

export function TimelinePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusVaultId = searchParams.get('vaultId')?.trim() || null;
  const focusDnaId = searchParams.get('dnaRecordId')?.trim() || null;
  const focusAssetId = searchParams.get('assetId')?.trim() || null;

  const [files, setFiles] = useState<ActivityFile[] | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [geoAnalytics, setGeoAnalytics] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [liveSessions, setLiveSessions] = useState<{ live: any[]; concurrent: any[] }>({ live: [], concurrent: [] });

  const comparisons = useMemo(
    () =>
      listForensicReports()
        .filter((e): e is { kind: 'comparison'; id: string; savedAt: string; data: ComparisonResult } => e.kind === 'comparison')
        .map((e) => e.data),
    [],
  );

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleExpanded = (key: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const load = useRef(() => {});
  load.current = () => {
    setLoading(true);
    getOwnerActivity()
      .then(({ files: rows, unavailable: gaps }) => {
        setFiles(rows);
        setUnavailable(gaps);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load activity'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load.current();
    const id = setInterval(() => load.current(), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    api.get(`${API_BASE_URL}/share/analytics/geo`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }) => setGeoAnalytics((data as any).analytics ?? []))
      .catch(() => {});
    api.get(`${API_BASE_URL}/share/sessions/live`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }) => setLiveSessions({ live: (data as any).live ?? [], concurrent: (data as any).concurrent ?? [] }))
      .catch(() => {});
  }, []);

  /** Server events plus this browser's comparison reports, in one order. */
  const eventsByKey = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    for (const file of files ?? []) {
      const merged = [...file.events, ...comparisonEvents(file, comparisons)];
      merged.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      map.set(file.key, merged);
    }
    return map;
  }, [files, comparisons]);

  const filtered = useMemo(() => {
    const list = files ?? [];
    const bySearch = list.filter(
      (f) =>
        (filterType === 'ALL' || f.assetType === filterType) &&
        (f.filename.toLowerCase().includes(search.toLowerCase()) ||
          f.otherFilenames.some((n) => n.toLowerCase().includes(search.toLowerCase()))),
    );
    if (focusAssetId) return bySearch.filter((f) => f.assetIds.includes(focusAssetId));
    if (focusVaultId) return bySearch.filter((f) => f.vaultIds.includes(focusVaultId));
    if (focusDnaId) return bySearch.filter((f) => f.dnaIds.includes(focusDnaId));
    return bySearch;
  }, [files, filterType, search, focusAssetId, focusVaultId, focusDnaId]);

  // A file linked to from elsewhere opens with its log already unrolled.
  useEffect(() => {
    if (!focusAssetId && !focusVaultId && !focusDnaId) return;
    const match = filtered[0];
    if (!match) return;
    setExpandedKeys((prev) => (prev.has(match.key) ? prev : new Set(prev).add(match.key)));
  }, [filtered, focusAssetId, focusVaultId, focusDnaId]);

  const focused = Boolean(focusAssetId || focusVaultId || focusDnaId);
  const shown = focused ? filtered : (files ?? []);
  const fileTypes = useMemo(() => ['ALL', ...new Set((files ?? []).map((f) => f.assetType))], [files]);
  const totalEvents = shown.reduce((sum, f) => sum + (eventsByKey.get(f.key)?.length ?? 0), 0);

  return (
    <div className="page-shell space-y-5 animate-fade-in">

      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {!loading && <Badge variant="dna">{shown.length} files · {totalEvents} events</Badge>}
          <button onClick={() => load.current()} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {focused && filtered[0] && (
        <div className="rounded-xl border border-dna-500/30 bg-dna-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs text-dna-200">Showing this file</p>
            <p className="text-sm font-semibold text-white">{filtered[0].filename}</p>
          </div>
          <button
            type="button"
            className="text-2xs font-semibold text-dna-300 hover:text-white"
            onClick={() => navigate('/timeline')}
          >
            Show all files
          </button>
        </div>
      )}

      {unavailable.length > 0 && (
        <p className="rounded-xl border border-bg-border bg-bg-elevated px-4 py-2.5 text-xs text-gray-400">
          Not counted right now: {unavailable.join(', ')}. Those lines are missing from the logs below
          rather than shown as nothing having happened.
        </p>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {([
          ['PROTECTED', 'Protected'],
          ['VAULT_STORED', 'Stored'],
          ['CERTIFICATE_ISSUED', 'Certificate'],
          ['PORTFOLIO_ADDED', 'Portfolio'],
          ['SHARE_CREATED', 'Shared'],
          ['EXCHANGE_LISTED', 'Exchange'],
          ['FOUND_ONLINE', 'Found online'],
          ['DELETED', 'Deleted'],
        ] as Array<[ActivityEventType, string]>).map(([type, label]) => (
          <div key={type} className="flex items-center gap-2">
            <div className={cn('w-6 h-6 rounded-full border flex items-center justify-center', (EVENT_STYLE[type] ?? DEFAULT_STYLE).color)}>
              {(EVENT_STYLE[type] ?? DEFAULT_STYLE).icon}
            </div>
            <span className="text-xs text-gray-400">{label}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" placeholder="Search by filename"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter size={13} className="text-gray-500" />
          {fileTypes.map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={cn(
                'text-xs px-3 py-1.5 rounded-full border transition-all',
                filterType === t
                  ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                  : 'border-bg-border text-gray-500 hover:text-white',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      {!loading && shown.length > 0 && (
        <div className="stat-grid-4 gap-3">
          {[
            { icon: <Dna size={16} className="text-dna-400" />, label: 'Files tracked', value: shown.length },
            { icon: <Lock size={16} className="text-success" />, label: 'Files stored', value: shown.filter((f) => f.vaultIds.length > 0).length },
            { icon: <Award size={16} className="text-purple" />, label: 'With certificate', value: shown.filter((f) => f.certificateId).length },
            { icon: <Shield size={16} className="text-purple" />, label: 'Total events', value: totalEvents },
          ].map((item) => (
            <div key={item.label} className="card-sm flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-bg-elevated flex items-center justify-center">{item.icon}</div>
              <div>
                <p className="text-lg font-bold text-white">{item.value}</p>
                <p className="text-2xs text-gray-500">{item.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Geo + live sessions */}
      {!focused && (geoAnalytics.length > 0 || liveSessions.live.length > 0 || liveSessions.concurrent.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {geoAnalytics.length > 0 && (
            <div className="card">
              <p className="text-xs font-semibold text-white mb-3">Where your files were opened</p>
              <div className="space-y-2">
                {geoAnalytics.slice(0, 6).map((g, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="min-w-0">
                      <span className="text-gray-300">{g.country ?? 'Unknown'}</span>
                      {g.cities?.length > 0 && (
                        <span className="text-gray-600 ml-1.5">· {g.cities.slice(0, 3).join(', ')}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {g.riskCount > 0 && <Badge variant="danger">{g.riskCount} risky</Badge>}
                      <span className="text-gray-500 mono">{g.count} events</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(liveSessions.live.length > 0 || liveSessions.concurrent.length > 0) && (
            <div className="card">
              <p className="text-xs font-semibold text-white mb-3">Open right now</p>
              <div className="space-y-2">
                {liveSessions.live.length === 0 && (
                  <p className="text-2xs text-gray-500">No one has opened a link in the last 5 minutes</p>
                )}
                {liveSessions.live.slice(0, 6).map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-300 mono">{(s.token ?? '').slice(0, 12)}…</span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">{s.recipientName ?? s.country ?? 'Anonymous'}</span>
                      <Badge variant="success">live</Badge>
                    </div>
                  </div>
                ))}
                {liveSessions.concurrent.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-bg-border">
                    <p className="text-2xs text-warning font-semibold mb-1">Same link open in more than one place</p>
                    {liveSessions.concurrent.slice(0, 4).map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-2xs text-gray-400">
                        <span className="mono">{(c.token ?? '').slice(0, 12)}…</span>
                        <span>{c.sessionCount} sessions</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* The logs */}
      {loading && !files ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : error ? (
        <div className="card text-center">
          <p className="text-danger text-sm">{error}</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Clock}
            title="No activity yet"
            description="Protect your first file and everything that happens to it is kept here."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((f) => (
            <FileLogCard
              key={f.key}
              file={f}
              events={eventsByKey.get(f.key) ?? []}
              expanded={expandedKeys.has(f.key)}
              onToggle={() => toggleExpanded(f.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
