/**
 * PINIT-DNA — Monitoring & Crawler Dashboard (Production Grade)
 * Route: /monitoring
 */

import { useState } from 'react';
import {
  Radio, Search, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, Play, Pause, Globe, Shield, Clock, Activity,
  FileText, Image, Music, Video, Zap, BarChart2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import axios from 'axios';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE_URL } from '../config/api.config';
import { useApi } from '../hooks/useApi';
import { listDnaRecords, deriveFileType } from '../services/dashboard.api';
import { Badge, FileTypeBadge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { cn } from '../components/ui/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonitoringRun {
  id: string;
  status: string;
  trigger: string;
  startedAt: string;
  durationMs: number | null;
  matchesFound: number;
}

interface MonitorRecord {
  id: string;
  dnaRecordId: string;
  filename: string;
  fileType: string;
  status: string;
  scanType: string;
  totalChecks: number;
  totalMatches: number;
  totalFailures: number;
  lastDurationMs: number | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  crawlResults: CrawlResult[];
  monitoringRuns: MonitoringRun[];
  _count: { crawlResults: number; monitoringRuns: number };
}

interface CrawlResult {
  id: string;
  url: string;
  pageTitle: string;
  similarity: number;
  matchType: string;
  alertStatus: string;
  foundText: string;
  checkedAt: string;
  evidenceGenerated: boolean;
  monitorRecord?: { filename: string; fileType: string; dnaRecordId: string };
}

interface Stats {
  totalMonitored: number;
  activeMonitors: number;
  pendingAlerts: number;
  confirmedMatches: number;
  totalRuns: number;
  exactMatches: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MATCH_CONFIG: Record<string, { color: string; bg: string; border: string; emoji: string; label: string }> = {
  EXACT_MATCH:    { color: 'text-danger',  bg: 'bg-danger/5',  border: 'border-danger/30',  emoji: '🚨', label: 'Exact Match'    },
  HIGH_MATCH:     { color: 'text-orange',  bg: 'bg-orange/5',  border: 'border-orange/30',  emoji: '⚠️', label: 'High Match'     },
  POSSIBLE_MATCH: { color: 'text-warning', bg: 'bg-warning/5', border: 'border-warning/30', emoji: '🔍', label: 'Possible Match' },
  NO_MATCH:       { color: 'text-gray-500', bg: '', border: '', emoji: '', label: 'No Match' },
  // legacy
  DUPLICATE:  { color: 'text-danger',  bg: 'bg-danger/5',  border: 'border-danger/30',  emoji: '🚨', label: 'Duplicate'   },
  NEAR_MATCH: { color: 'text-orange',  bg: 'bg-orange/5',  border: 'border-orange/30',  emoji: '⚠️', label: 'Near Match'  },
  POSSIBLE:   { color: 'text-warning', bg: 'bg-warning/5', border: 'border-warning/30', emoji: '🔍', label: 'Possible'    },
};

const FILE_CATEGORY_ICON: Record<string, React.ReactNode> = {
  IMAGE:    <Image size={12} className="text-blue-400" />,
  AUDIO:    <Music size={12} className="text-purple-400" />,
  VIDEO:    <Video size={12} className="text-red-400" />,
  DOCUMENT: <FileText size={12} className="text-green-400" />,
};

const SCAN_TYPES = ['MANUAL', 'DAILY', 'WEEKLY', 'CONTINUOUS'] as const;

function fileCategory(fileType: string): string {
  const ft = (fileType ?? '').toUpperCase();
  if (['JPG','JPEG','PNG','WEBP','GIF','IMAGE'].includes(ft)) return 'IMAGE';
  if (['MP3','WAV','FLAC','AAC','OGG','AUDIO'].includes(ft)) return 'AUDIO';
  if (['MP4','MOV','AVI','MKV','WEBM','VIDEO'].includes(ft)) return 'VIDEO';
  return 'DOCUMENT';
}

// ─── Alert Card ───────────────────────────────────────────────────────────────

function AlertCard({ alert, onDismiss, onConfirm }: {
  alert: CrawlResult; onDismiss: () => void; onConfirm: () => void;
}) {
  const cfg = MATCH_CONFIG[alert.matchType] ?? MATCH_CONFIG['POSSIBLE_MATCH'];
  const pct = Math.round(alert.similarity * 100);
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={cn('card border transition-all', cfg.bg, cfg.border)}>
      <div className="flex items-start gap-3">
        <div className={cn('text-xl shrink-0', cfg.color)}>{cfg.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant={alert.matchType.includes('EXACT') || alert.matchType === 'DUPLICATE' ? 'danger' :
                            alert.matchType.includes('HIGH')  || alert.matchType === 'NEAR_MATCH' ? 'orange' : 'warning'}>
              {cfg.label}
            </Badge>
            <span className={cn('text-lg font-bold mono', cfg.color)}>{pct}%</span>
            {alert.monitorRecord && <FileTypeBadge type={alert.monitorRecord.fileType} />}
            {alert.evidenceGenerated && <Badge variant="dna">Evidence Saved</Badge>}
          </div>
          {alert.monitorRecord && (
            <p className="text-xs font-semibold text-white mb-1">{alert.monitorRecord.filename}</p>
          )}
          <p className="text-xs text-gray-400 truncate mb-1">{alert.pageTitle || 'No title'}</p>
          <a href={alert.url} target="_blank" rel="noreferrer"
            className="text-2xs text-dna-400 hover:underline truncate block mono">
            {alert.url.slice(0, 80)}{alert.url.length > 80 ? '…' : ''}
          </a>
          {alert.foundText && (
            <p className="text-2xs text-gray-500 mt-2 line-clamp-2">{alert.foundText.slice(0, 150)}</p>
          )}
          <p className="text-2xs text-gray-600 mt-1">
            Found {format(new Date(alert.checkedAt), 'MMM d, HH:mm')}
          </p>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button onClick={onConfirm} className="btn btn-danger btn-sm text-2xs px-2 py-1">
            <CheckCircle2 size={11} /> Confirm
          </button>
          <button onClick={onDismiss} className="btn btn-secondary btn-sm text-2xs px-2 py-1">
            <XCircle size={11} /> Dismiss
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Monitor Card ─────────────────────────────────────────────────────────────

function MonitorCard({ m, onCheck, onPause, onResume, onScanTypeChange, checking }: {
  m: MonitorRecord;
  onCheck: () => void;
  onPause: () => void;
  onResume: () => void;
  onScanTypeChange: (t: string) => void;
  checking: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const cat = fileCategory(m.fileType);

  return (
    <div className="card">
      <div className="flex items-start gap-3">
        <div className={cn('w-2 h-2 rounded-full mt-2 shrink-0',
          m.status === 'ACTIVE' ? 'bg-success animate-pulse' :
          m.status === 'PAUSED' ? 'bg-warning' : 'bg-gray-500')} />

        <div className="flex-1 min-w-0">
          {/* File info */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <FileTypeBadge type={m.fileType} />
            <span className="text-xs text-gray-500">{FILE_CATEGORY_ICON[cat]}</span>
            <p className="text-sm font-semibold text-white truncate">{m.filename}</p>
            <Badge variant={m.status === 'ACTIVE' ? 'success' : m.status === 'PAUSED' ? 'warning' : 'muted'}>
              {m.status}
            </Badge>
            <Badge variant="muted">{m.scanType}</Badge>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-4 text-2xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1"><Activity size={10} /> {m.totalChecks} checks</span>
            <span className={cn('flex items-center gap-1', m.totalMatches > 0 ? 'text-warning' : '')}>
              <AlertTriangle size={10} /> {m.totalMatches} matches
            </span>
            {m.totalFailures > 0 && (
              <span className="flex items-center gap-1 text-danger"><XCircle size={10} /> {m.totalFailures} failures</span>
            )}
            {m.lastDurationMs && (
              <span className="flex items-center gap-1"><Clock size={10} /> {(m.lastDurationMs/1000).toFixed(1)}s last run</span>
            )}
            {m.lastCheckedAt && (
              <span>Last: {formatDistanceToNow(new Date(m.lastCheckedAt), { addSuffix: true })}</span>
            )}
            {m.nextCheckAt && m.status === 'ACTIVE' && (
              <span>Next: {formatDistanceToNow(new Date(m.nextCheckAt), { addSuffix: true })}</span>
            )}
          </div>

          {/* Scan type selector */}
          <div className="flex items-center gap-1 mt-2">
            {SCAN_TYPES.map(t => (
              <button key={t} onClick={() => onScanTypeChange(t)}
                className={cn('text-2xs px-2 py-0.5 rounded-full border transition-all',
                  m.scanType === t
                    ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                    : 'border-bg-border text-gray-600 hover:text-gray-400')}>
                {t === 'CONTINUOUS' ? <Zap size={9} className="inline mr-0.5" /> : null}{t}
              </button>
            ))}
          </div>

          {/* Recent matches */}
          {m.crawlResults.length > 0 && (
            <div className="mt-2 space-y-1">
              {m.crawlResults.slice(0, 2).map(r => {
                const mc = MATCH_CONFIG[r.matchType] ?? MATCH_CONFIG['POSSIBLE_MATCH'];
                return (
                  <div key={r.id} className="flex items-center gap-2 bg-bg-elevated rounded p-1.5">
                    <Globe size={10} className="text-gray-500 shrink-0" />
                    <span className="text-2xs text-gray-400 truncate flex-1">{r.url.slice(0, 60)}…</span>
                    <span className={cn('text-2xs font-bold shrink-0', mc.color)}>
                      {Math.round(r.similarity * 100)}%
                    </span>
                    <span className={cn('text-2xs shrink-0', mc.color)}>{mc.emoji}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Run history (expandable) */}
          {m.monitoringRuns.length > 0 && (
            <div className="mt-2">
              <button onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-2xs text-gray-600 hover:text-gray-400 transition-colors">
                <BarChart2 size={10} />
                {m._count.monitoringRuns} runs
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
              {expanded && (
                <div className="mt-1 space-y-1">
                  {m.monitoringRuns.map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-2xs bg-bg-elevated rounded px-2 py-1">
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                        r.status === 'COMPLETED' ? 'bg-success' :
                        r.status === 'FAILED'    ? 'bg-danger'  : 'bg-warning animate-pulse')} />
                      <span className="text-gray-500">{format(new Date(r.startedAt), 'MMM d HH:mm')}</span>
                      <span className="text-gray-600">{r.trigger}</span>
                      {r.durationMs && <span className="text-gray-600">{(r.durationMs/1000).toFixed(1)}s</span>}
                      <span className={r.matchesFound > 0 ? 'text-warning ml-auto' : 'text-gray-600 ml-auto'}>
                        {r.matchesFound} matches
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onCheck} disabled={checking}
            className="btn btn-secondary btn-sm text-xs" title="Run check now">
            {checking ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
            {checking ? 'Checking…' : 'Check Now'}
          </button>
          {m.status === 'ACTIVE'
            ? <button onClick={onPause} className="btn-ghost btn-icon" title="Pause"><Pause size={12} /></button>
            : <button onClick={onResume} className="btn-ghost btn-icon" title="Resume"><Play size={12} /></button>}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function MonitoringPage() {
  const [monitors,    setMonitors]    = useState<MonitorRecord[]>([]);
  const [alerts,      setAlerts]      = useState<CrawlResult[]>([]);
  const [stats,       setStats]       = useState<Stats | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [enrollOpen,  setEnrollOpen]  = useState(false);
  const [checking,    setChecking]    = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<Record<string, unknown> | null>(null);
  const [enrollScanType, setEnrollScanType] = useState<string>('DAILY');
  const [enrollUrls,  setEnrollUrls]  = useState('');
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const [alertTab,    setAlertTab]    = useState<'PENDING'|'CONFIRMED'|'DISMISSED'>('PENDING');

  const { data: dnaRecords } = useApi(listDnaRecords);

  const load = async () => {
    setLoading(true);
    try {
      const [mResp, aResp, sResp] = await Promise.all([
        axios.get(`${API_BASE_URL}/monitor`),
        axios.get(`${API_BASE_URL}/monitor/alerts?status=${alertTab}`),
        axios.get(`${API_BASE_URL}/monitor/stats`),
      ]);
      setMonitors((mResp.data as any).monitors ?? []);
      setAlerts((aResp.data as any).alerts ?? []);
      setStats(sResp.data as any);
    } catch { toast.error('Failed to load monitoring data'); }
    finally { setLoading(false); }
  };

  useState(() => { load(); });

  const handleEnroll = async (dnaRecordId: string) => {
    setEnrollingId(dnaRecordId);
    try {
      const watchUrls = enrollUrls.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
      await axios.post(`${API_BASE_URL}/monitor/enroll/${dnaRecordId}`, { watchUrls, scanType: enrollScanType });
      toast.success('File enrolled for monitoring');
      setEnrollOpen(false); setEnrollUrls('');
      load();
    } catch { toast.error('Enrollment failed'); }
    finally { setEnrollingId(null); }
  };

  const handleCheck = async (id: string) => {
    setChecking(id);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/monitor/${id}/check`);
      const d = data as any;
      const result = d.result ?? d;
      setCheckResult(result);
      toast.success(`Check complete — ${result.matchesFound ?? 0} match(es) found`);
      load();
    } catch { toast.error('Check failed'); }
    finally { setChecking(null); }
  };

  const handleDismiss = async (alertId: string) => {
    await axios.post(`${API_BASE_URL}/monitor/alerts/${alertId}/dismiss`);
    setAlerts(prev => prev.filter(a => a.id !== alertId));
    toast.success('Alert dismissed');
  };

  const handleConfirm = async (alertId: string) => {
    await axios.post(`${API_BASE_URL}/monitor/alerts/${alertId}/confirm`);
    setAlerts(prev => prev.filter(a => a.id !== alertId));
    toast.success('Match confirmed');
  };

  const handleScanTypeChange = async (monitorId: string, scanType: string) => {
    try {
      await axios.patch(`${API_BASE_URL}/monitor/${monitorId}/scan-type`, { scanType });
      setMonitors(prev => prev.map(m => m.id === monitorId ? { ...m, scanType } : m));
      toast.success(`Schedule set to ${scanType}`);
    } catch { toast.error('Failed to update schedule'); }
  };

  const notMonitored = (dnaRecords ?? []).filter(r => !monitors.some(m => m.dnaRecordId === r.id));

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Monitoring & Crawler</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Production-grade monitoring for PDF · DOCX · TXT · Images · Audio · Video
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEnrollOpen(true)} className="btn btn-primary btn-sm">
            <Radio size={14} /> Enroll File
          </button>
          <button onClick={load} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { label: 'Monitored',    value: stats.totalMonitored,   icon: <Shield size={14} className="text-dna-400" /> },
            { label: 'Active',       value: stats.activeMonitors,   icon: <Radio size={14} className="text-success" /> },
            { label: 'Total Runs',   value: stats.totalRuns,        icon: <Activity size={14} className="text-blue-400" /> },
            { label: 'Exact Matches',value: stats.exactMatches,     icon: <AlertTriangle size={14} className="text-danger" /> },
            { label: 'Pending',      value: stats.pendingAlerts,    icon: <Clock size={14} className="text-warning" /> },
            { label: 'Confirmed',    value: stats.confirmedMatches, icon: <CheckCircle2 size={14} className="text-orange" /> },
          ].map(s => (
            <div key={s.label} className="card-sm flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-bg-elevated flex items-center justify-center shrink-0">{s.icon}</div>
              <div>
                <p className="text-lg font-bold text-white">{s.value}</p>
                <p className="text-2xs text-gray-500">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Alerts section */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <AlertTriangle size={16} className="text-warning" />
          <h2 className="text-sm font-semibold text-white">Match Alerts</h2>
          <div className="flex items-center gap-1 ml-auto">
            {(['PENDING','CONFIRMED','DISMISSED'] as const).map(t => (
              <button key={t} onClick={() => { setAlertTab(t); setTimeout(load, 0); }}
                className={cn('text-2xs px-2 py-1 rounded-full border transition-all',
                  alertTab === t ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                                 : 'border-bg-border text-gray-500 hover:text-white')}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {alerts.length === 0 ? (
          <div className="card py-8 text-center">
            <CheckCircle2 size={24} className="text-success mx-auto mb-2" />
            <p className="text-sm text-gray-400">No {alertTab.toLowerCase()} alerts</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {alerts.map(a => (
                <AlertCard key={a.id} alert={a}
                  onDismiss={() => handleDismiss(a.id)}
                  onConfirm={() => handleConfirm(a.id)} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Check result */}
      <AnimatePresence>
        {checkResult && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className={cn('card border', (checkResult['matchesFound'] as number) > 0 ? 'border-warning/30 bg-warning/5' : 'border-success/30 bg-success/5')}>
            <div className="flex items-center gap-3 mb-3">
              {(checkResult['matchesFound'] as number) > 0
                ? <AlertTriangle size={18} className="text-warning" />
                : <CheckCircle2 size={18} className="text-success" />}
              <div className="flex-1">
                <p className="font-semibold text-white">
                  Scan Complete — {(checkResult['matchesFound'] as number) > 0
                    ? `${checkResult['matchesFound']} match(es) found`
                    : 'No matches found'}
                </p>
                <p className="text-2xs text-gray-500 mono mt-0.5">
                  Category: {String(checkResult['fileCategory'] ?? checkResult['method'] ?? 'DOCUMENT')}
                  {checkResult['durationMs'] ? ` · ${((checkResult['durationMs'] as number)/1000).toFixed(1)}s` : ''}
                </p>
              </div>
              <button onClick={() => setCheckResult(null)} className="btn-ghost btn-icon"><XCircle size={14} /></button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: 'URLs Checked',   value: checkResult['urlsChecked'] },
                { label: 'Candidates',     value: checkResult['candidatesFound'] ?? checkResult['candidatesDownloaded'] ?? 0 },
                { label: 'Matches',        value: checkResult['matchesFound'] },
                { label: 'Peak Similarity',value: `${checkResult['highestSimilarity']}%` },
              ].map(s => (
                <div key={s.label} className="bg-bg-elevated rounded-lg p-2">
                  <p className="text-sm font-bold text-white">{String(s.value)}</p>
                  <p className="text-2xs text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Monitors list */}
      <div>
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Radio size={14} className="text-dna-400" />
          Monitored Files
          <span className="text-2xs text-gray-600">({monitors.length})</span>
        </h2>
        {loading ? (
          <div className="space-y-3">{Array.from({length:3}).map((_,i) => <SkeletonCard key={i} />)}</div>
        ) : monitors.length === 0 ? (
          <div className="card">
            <EmptyState icon={Radio} title="No files being monitored"
              description="Enroll files to start monitoring them for unauthorized copies"
              action={<button onClick={() => setEnrollOpen(true)} className="btn btn-primary btn-sm"><Radio size={14} /> Enroll First File</button>} />
          </div>
        ) : (
          <div className="space-y-3">
            {monitors.map(m => (
              <MonitorCard key={m.id} m={m}
                checking={checking === m.id}
                onCheck={() => handleCheck(m.id)}
                onPause={() => axios.post(`${API_BASE_URL}/monitor/${m.id}/pause`).then(load)}
                onResume={() => axios.post(`${API_BASE_URL}/monitor/${m.id}/resume`).then(load)}
                onScanTypeChange={(t) => handleScanTypeChange(m.id, t)} />
            ))}
          </div>
        )}
      </div>

      {/* Enroll modal */}
      <Modal open={enrollOpen} onClose={() => { setEnrollOpen(false); setEnrollUrls(''); }}
        title="Enroll File for Monitoring" size="md">
        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs text-gray-400 mb-3">
              Select a file and scan schedule. The system will crawl the web and compare using
              content fingerprints, embeddings, and similarity algorithms.
            </p>

            {/* Scan type */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-300 mb-2">Scan Schedule</p>
              <div className="flex gap-2 flex-wrap">
                {SCAN_TYPES.map(t => (
                  <button key={t} onClick={() => setEnrollScanType(t)}
                    className={cn('text-xs px-3 py-1.5 rounded-full border transition-all',
                      enrollScanType === t
                        ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                        : 'border-bg-border text-gray-500 hover:text-white')}>
                    {t === 'CONTINUOUS' && <Zap size={10} className="inline mr-1" />}
                    {t}
                    <span className="text-2xs text-gray-600 ml-1">
                      {t === 'MANUAL' ? '(on-demand)' : t === 'DAILY' ? '(every 24h)' : t === 'WEEKLY' ? '(every 7d)' : '(every 1h)'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Watch URLs */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-300 mb-1">Watch URLs (optional)</p>
              <textarea value={enrollUrls} onChange={e => setEnrollUrls(e.target.value)}
                placeholder="https://example.com&#10;https://another-site.com"
                className="input text-xs font-mono w-full" rows={3} />
              <p className="text-2xs text-gray-600 mt-1">One URL per line. Leave empty to use auto-generated search URLs.</p>
            </div>
          </div>

          {notMonitored.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">All files are already enrolled.</p>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {notMonitored.map(r => (
                <button key={r.id} onClick={() => handleEnroll(r.id)}
                  disabled={enrollingId === r.id}
                  className="w-full flex items-center gap-3 p-3 bg-bg-elevated hover:bg-bg-muted rounded-xl border border-bg-border transition-all text-left disabled:opacity-60">
                  <FileTypeBadge type={deriveFileType(r)} />
                  <span className="text-xs text-gray-500 shrink-0">
                    {FILE_CATEGORY_ICON[fileCategory(deriveFileType(r))]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{r.imageFilename}</p>
                    <p className="text-2xs text-gray-500 mono">{r.id.slice(0,12)}…</p>
                  </div>
                  {enrollingId === r.id
                    ? <RefreshCw size={14} className="text-dna-400 shrink-0 animate-spin" />
                    : <Radio size={14} className="text-dna-400 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
