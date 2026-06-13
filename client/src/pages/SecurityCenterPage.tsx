import { api } from '../services/dashboard.api';
/**
 * PINIT-DNA — Security Center (Phase 4)
 * Route: /security-center
 *
 * Tabs:
 *   Incidents     — filterable list, severity badges, resolve/dismiss actions, generate report
 *   Evidence      — all evidence records with metadata
 *   Recipients    — REC-XXXX profiles with watermark history
 *   Leak Scanner  — upload leaked file → watermark extraction → attribution report
 */

import { useState, useRef, useCallback } from 'react';
import {
  ShieldAlert, AlertTriangle, AlertOctagon, CheckCircle2,
  RefreshCw, ChevronDown, FileText, Users, Upload,
  Search, Filter, Download,
  Target, Fingerprint, Globe, X, Shield,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { formatDistanceToNow, format } from 'date-fns';
import { API_BASE_URL } from '../config/api.config';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Incident {
  id:           string;
  incidentCode: string;
  severity:     'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status:       'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'DISMISSED';
  triggerType:  string;
  description:  string;
  dnaRecordId:  string | null;
  shareLinkId:  string | null;
  recipientId:  string | null;
  createdAt:    string;
  evidenceRecords: { id: string; evidenceCode: string; evidenceType: string }[];
}

interface EvidenceRecord {
  id:           string;
  evidenceCode: string;
  evidenceType: string;
  description:  string;
  createdAt:    string;
  dnaRecordId:  string | null;
  shareLinkId:  string | null;
  hash:         string | null;
  incident:     { incidentCode: string; severity: string; status: string } | null;
}

interface RecipientProfile {
  id:            string;
  recipientCode: string;
  fingerprint:   string | null;
  firstSeen:     string;
  lastSeen:      string;
  countries:     string[];
  devices:       string[];
  totalSessions: number;
  watermarkProfiles: {
    watermarkCode: string;
    extractedAt:   string | null;
    createdAt:     string;
  }[];
}

interface AttributionResult {
  found:             boolean;
  watermarkCode:     string | null;
  extractionMethod:  string;
  confidence:        number;
  attribution: {
    watermarkProfile: object;
    recipientProfile: RecipientProfile | null;
    shareLink: object | null;
  } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityColor(sev: string) {
  if (sev === 'CRITICAL') return 'text-red-400 bg-red-500/15 border-red-500/30';
  if (sev === 'HIGH')     return 'text-orange-400 bg-orange-500/15 border-orange-500/30';
  if (sev === 'MEDIUM')   return 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30';
  return 'text-green-400 bg-green-500/15 border-green-500/30';
}

function severityDot(sev: string) {
  if (sev === 'CRITICAL') return 'bg-red-500';
  if (sev === 'HIGH')     return 'bg-orange-500';
  if (sev === 'MEDIUM')   return 'bg-yellow-500';
  return 'bg-green-500';
}

function statusColor(st: string) {
  if (st === 'OPEN')          return 'text-red-400 bg-red-500/10 border-red-500/25';
  if (st === 'INVESTIGATING') return 'text-blue-400 bg-blue-500/10 border-blue-500/25';
  if (st === 'RESOLVED')      return 'text-green-400 bg-green-500/10 border-green-500/25';
  return 'text-gray-400 bg-gray-500/10 border-gray-500/25';
}

function triggerIcon(t: string) {
  if (t.includes('SCREENSHOT')) return '📸';
  if (t.includes('DOWNLOAD'))   return '⬇️';
  if (t.includes('COUNTRY'))    return '🌍';
  if (t.includes('LEAK'))       return '🕵️';
  if (t.includes('VPN'))        return '🔒';
  return '⚠️';
}

function SeverityBadge({ sev }: { sev: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-semibold ${severityColor(sev)}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${severityDot(sev)}`} />
      {sev}
    </span>
  );
}

function StatusBadge({ st }: { st: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${statusColor(st)}`}>
      {st}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: number | string;
  sub?: string; color: string;
}) {
  return (
    <div className={`bg-bg-card border border-bg-border rounded-xl p-4`}>
      <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center mb-3`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
      {sub && <p className="text-2xs text-gray-600 mono mt-1">{sub}</p>}
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'incidents', label: 'Incidents',       icon: AlertOctagon },
  { id: 'evidence',  label: 'Evidence Records', icon: FileText     },
  { id: 'recipients',label: 'Recipients',       icon: Users        },
  { id: 'scanner',   label: 'Leak Scanner',     icon: Target       },
] as const;

type TabId = typeof TABS[number]['id'];

// ── Incidents tab ─────────────────────────────────────────────────────────────

function IncidentsTab() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState({ severity: '', status: '' });
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [updating, setUpdating]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { limit: '100' };
      if (filter.severity) params['severity'] = filter.severity;
      if (filter.status)   params['status']   = filter.status;
      const { data } = await api.get(`${API_BASE_URL}/evidence/incidents`, { params });
      setIncidents((data as any).incidents ?? []);
    } catch { toast.error('Failed to load incidents'); }
    finally { setLoading(false); }
  }, [filter]);

  // Load on mount + filter change
  useState(() => { load(); });

  async function updateStatus(id: string, status: string) {
    setUpdating(id);
    try {
      await api.patch(`${API_BASE_URL}/evidence/incidents/${id}`, { status });
      toast.success(`Incident marked ${status}`);
      load();
    } catch { toast.error('Failed to update incident'); }
    finally { setUpdating(null); }
  }

  async function generateReport(inc: Incident) {
    const toastId = toast.loading('Generating evidence report…');
    try {
      const payload: Record<string, string> = { type: 'INCIDENT', incidentId: inc.id };
      if (inc.dnaRecordId)  payload['dnaRecordId']  = inc.dnaRecordId;
      if (inc.shareLinkId)  payload['shareLinkId']  = inc.shareLinkId;
      const res = await api.post(`${API_BASE_URL}/evidence/report`, payload, { responseType: 'blob' });
      const url  = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'application/pdf' }));
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `PINIT-DNA-Incident-${inc.incidentCode}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Evidence report downloaded', { id: toastId });
    } catch { toast.error('Report generation failed', { id: toastId }); }
  }

  const openCount    = incidents.filter(i => i.status === 'OPEN').length;
  const criticalCount= incidents.filter(i => i.severity === 'CRITICAL').length;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Filter size={13} /> Filter:
        </div>
        {['', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(s => (
          <button
            key={s}
            onClick={() => { setFilter(f => ({ ...f, severity: s })); setTimeout(load, 0); }}
            className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
              filter.severity === s
                ? 'border-dna-500 bg-dna-500/15 text-dna-400'
                : 'border-bg-border text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            {s || 'All Severities'}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {['', 'OPEN', 'INVESTIGATING', 'RESOLVED'].map(s => (
            <button
              key={s}
              onClick={() => { setFilter(f => ({ ...f, status: s })); setTimeout(load, 0); }}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                filter.status === s
                  ? 'border-dna-500 bg-dna-500/15 text-dna-400'
                  : 'border-bg-border text-gray-500 hover:text-gray-300'
              }`}
            >
              {s || 'All Statuses'}
            </button>
          ))}
          <button onClick={load} className="p-1.5 rounded-lg border border-bg-border text-gray-500 hover:text-gray-300 transition-all">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {incidents.length > 0 && (
        <div className="flex gap-4 text-xs text-gray-500 bg-bg-elevated border border-bg-border rounded-lg px-4 py-2">
          <span>{incidents.length} total</span>
          <span className="text-red-400 font-semibold">{openCount} open</span>
          <span className="text-red-500 font-bold">{criticalCount} critical</span>
        </div>
      )}

      {/* Incidents list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-bg-card border border-bg-border rounded-xl p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : incidents.length === 0 ? (
        <div className="bg-bg-card border border-bg-border rounded-xl p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500/40 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">No incidents detected</p>
          <p className="text-xs text-gray-600 mt-1">System is clean — no anomalies triggered</p>
        </div>
      ) : (
        <div className="space-y-2">
          {incidents.map(inc => (
            <div
              key={inc.id}
              className={`bg-bg-card border rounded-xl overflow-hidden transition-all ${
                inc.severity === 'CRITICAL' ? 'border-red-500/30' :
                inc.severity === 'HIGH'     ? 'border-orange-500/20' :
                'border-bg-border'
              }`}
            >
              {/* Row */}
              <button
                onClick={() => setExpanded(expanded === inc.id ? null : inc.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                <span className="text-base">{triggerIcon(inc.triggerType)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold mono text-dna-400">{inc.incidentCode}</span>
                    <SeverityBadge sev={inc.severity} />
                    <StatusBadge st={inc.status} />
                    <span className="text-xs text-gray-600 mono">{inc.triggerType}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{inc.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xs text-gray-600 mono">
                    {formatDistanceToNow(new Date(inc.createdAt), { addSuffix: true })}
                  </p>
                  <ChevronDown
                    size={13}
                    className={`ml-auto mt-1 text-gray-600 transition-transform ${expanded === inc.id ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>

              {/* Expanded */}
              <AnimatePresence>
                {expanded === inc.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-bg-border px-4 py-4 bg-bg-elevated/50 space-y-3">
                      {/* Meta grid */}
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        {inc.dnaRecordId && (
                          <div>
                            <p className="text-gray-600 mb-0.5">DNA Record</p>
                            <p className="text-dna-400 mono truncate">{inc.dnaRecordId}</p>
                          </div>
                        )}
                        {inc.shareLinkId && (
                          <div>
                            <p className="text-gray-600 mb-0.5">Share Link</p>
                            <p className="text-purple mono truncate">{inc.shareLinkId}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-gray-600 mb-0.5">Created</p>
                          <p className="text-gray-300 mono">{format(new Date(inc.createdAt), 'PPpp')}</p>
                        </div>
                        <div>
                          <p className="text-gray-600 mb-0.5">Evidence records</p>
                          <p className="text-gray-300">{inc.evidenceRecords.length} linked</p>
                        </div>
                      </div>

                      {/* Description */}
                      <div className="bg-bg-card rounded-lg px-3 py-2">
                        <p className="text-xs text-gray-500 mb-1">Description</p>
                        <p className="text-xs text-gray-300">{inc.description}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-1">
                        {inc.status === 'OPEN' && (
                          <button
                            onClick={() => updateStatus(inc.id, 'INVESTIGATING')}
                            disabled={updating === inc.id}
                            className="btn btn-secondary btn-sm text-xs gap-1.5"
                          >
                            <Search size={11} /> Investigate
                          </button>
                        )}
                        {(inc.status === 'OPEN' || inc.status === 'INVESTIGATING') && (
                          <button
                            onClick={() => updateStatus(inc.id, 'RESOLVED')}
                            disabled={updating === inc.id}
                            className="btn btn-sm text-xs gap-1.5 bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20"
                          >
                            <CheckCircle2 size={11} /> Resolve
                          </button>
                        )}
                        {inc.status !== 'DISMISSED' && (
                          <button
                            onClick={() => updateStatus(inc.id, 'DISMISSED')}
                            disabled={updating === inc.id}
                            className="btn btn-sm text-xs gap-1.5 bg-gray-500/10 border border-gray-500/20 text-gray-500 hover:text-gray-300"
                          >
                            <X size={11} /> Dismiss
                          </button>
                        )}
                        <button
                          onClick={() => generateReport(inc)}
                          className="ml-auto btn btn-sm text-xs gap-1.5 bg-dna-500/10 border border-dna-500/30 text-dna-400 hover:bg-dna-500/20"
                        >
                          <Download size={11} /> Evidence Report PDF
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Evidence Records tab ──────────────────────────────────────────────────────

function EvidenceTab() {
  const [records, setRecords]   = useState<EvidenceRecord[]>([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`${API_BASE_URL}/evidence/records?limit=100`);
      setRecords((data as any).records ?? []);
    } catch { toast.error('Failed to load evidence records'); }
    finally { setLoading(false); }
  }, []);

  useState(() => { load(); });

  const typeIcon = (t: string) => {
    if (t === 'WATERMARK_MATCH')    return '🔏';
    if (t === 'EVIDENCE_REPORT')    return '📄';
    if (t === 'LEAK_ATTRIBUTION')   return '🎯';
    if (t === 'ACCESS_LOG')         return '📋';
    if (t === 'VIOLATION')          return '⚠️';
    return '📁';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{records.length} evidence records</p>
        <button onClick={load} className="p-1.5 rounded-lg border border-bg-border text-gray-500 hover:text-gray-300">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="bg-bg-card border border-bg-border rounded-xl h-16 animate-pulse" />)}
        </div>
      ) : records.length === 0 ? (
        <div className="bg-bg-card border border-bg-border rounded-xl p-12 text-center">
          <FileText className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">No evidence records yet</p>
          <p className="text-xs text-gray-600 mt-1">Records are auto-created when reports are generated</p>
        </div>
      ) : (
        <div className="bg-bg-card border border-bg-border rounded-xl divide-y divide-bg-border overflow-hidden">
          {records.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-lg shrink-0">{typeIcon(r.evidenceType)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold mono text-purple">{r.evidenceCode}</span>
                  <span className="text-2xs text-gray-600 border border-gray-700 rounded px-1.5 py-0.5">{r.evidenceType}</span>
                  {r.incident && <SeverityBadge sev={r.incident.severity} />}
                </div>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{r.description}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xs text-gray-600 mono">{format(new Date(r.createdAt), 'MM/dd HH:mm')}</p>
                {r.hash && (
                  <p className="text-2xs text-gray-700 mono truncate max-w-[120px]" title={r.hash}>
                    {r.hash.slice(0, 12)}…
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recipients tab ────────────────────────────────────────────────────────────

function RecipientsTab() {
  const [recipients, setRecipients] = useState<RecipientProfile[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`${API_BASE_URL}/evidence/recipients?limit=100`);
      setRecipients((data as any).recipients ?? []);
    } catch { toast.error('Failed to load recipients'); }
    finally { setLoading(false); }
  }, []);

  useState(() => { load(); });

  const leakedCount = (r: RecipientProfile) =>
    r.watermarkProfiles.filter(w => w.extractedAt).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{recipients.length} tracked recipients</p>
        <button onClick={load} className="p-1.5 rounded-lg border border-bg-border text-gray-500 hover:text-gray-300">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="bg-bg-card border border-bg-border rounded-xl h-20 animate-pulse" />)}
        </div>
      ) : recipients.length === 0 ? (
        <div className="bg-bg-card border border-bg-border rounded-xl p-12 text-center">
          <Users className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">No recipients tracked yet</p>
          <p className="text-xs text-gray-600 mt-1">Recipients are auto-identified when share links are accessed</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recipients.map(r => {
            const lk = leakedCount(r);
            return (
              <div
                key={r.id}
                className={`bg-bg-card border rounded-xl overflow-hidden ${
                  lk > 0 ? 'border-red-500/30' : 'border-bg-border'
                }`}
              >
                <button
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-dna-500/15 border border-dna-500/30 flex items-center justify-center shrink-0">
                    <Fingerprint size={14} className="text-dna-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold mono text-dna-400">{r.recipientCode}</span>
                      {lk > 0 && (
                        <span className="text-2xs bg-red-500/15 border border-red-500/30 text-red-400 px-2 py-0.5 rounded font-semibold">
                          {lk} LEAKED
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-2xs text-gray-600 flex items-center gap-1">
                        <Globe size={10} /> {r.countries.join(', ') || 'Unknown'}
                      </span>
                      <span className="text-2xs text-gray-600">
                        {r.totalSessions} session{r.totalSessions !== 1 ? 's' : ''}
                      </span>
                      <span className="text-2xs text-gray-600 mono">
                        {r.watermarkProfiles.length} watermark{r.watermarkProfiles.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xs text-gray-600 mono">
                      Last: {formatDistanceToNow(new Date(r.lastSeen), { addSuffix: true })}
                    </p>
                    <ChevronDown
                      size={13}
                      className={`ml-auto mt-1 text-gray-600 transition-transform ${expanded === r.id ? 'rotate-180' : ''}`}
                    />
                  </div>
                </button>

                <AnimatePresence>
                  {expanded === r.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-bg-border px-4 py-4 bg-bg-elevated/50 space-y-3">
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-gray-600 mb-0.5">First Seen</p>
                            <p className="text-gray-300 mono">{format(new Date(r.firstSeen), 'PPp')}</p>
                          </div>
                          <div>
                            <p className="text-gray-600 mb-0.5">Last Seen</p>
                            <p className="text-gray-300 mono">{format(new Date(r.lastSeen), 'PPp')}</p>
                          </div>
                          {r.countries.length > 0 && (
                            <div>
                              <p className="text-gray-600 mb-0.5">Countries</p>
                              <p className="text-gray-300">{r.countries.join(', ')}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-gray-600 mb-0.5">Device fingerprint</p>
                            <p className="text-gray-300 mono truncate">{r.fingerprint ? r.fingerprint.slice(0, 20) + '…' : '—'}</p>
                          </div>
                        </div>

                        {/* Watermark table */}
                        {r.watermarkProfiles.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 mb-2">Watermarks issued to this recipient</p>
                            <div className="bg-bg-card rounded-lg border border-bg-border divide-y divide-bg-border">
                              {r.watermarkProfiles.map(w => (
                                <div key={w.watermarkCode} className="flex items-center gap-3 px-3 py-2 text-xs">
                                  <span className="mono text-purple flex-1">{w.watermarkCode}</span>
                                  <span className="text-gray-600 mono">
                                    {format(new Date(w.createdAt), 'MM/dd HH:mm')}
                                  </span>
                                  {w.extractedAt ? (
                                    <span className="text-red-400 font-semibold flex items-center gap-1">
                                      <AlertTriangle size={10} /> LEAKED
                                    </span>
                                  ) : (
                                    <span className="text-green-400 flex items-center gap-1">
                                      <CheckCircle2 size={10} /> Secure
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Leak Scanner tab ──────────────────────────────────────────────────────────

function LeakScannerTab() {
  const [file, setFile]               = useState<File | null>(null);
  const [scanning, setScanning]       = useState(false);
  const [result, setResult]           = useState<AttributionResult | null>(null);
  const [generatingReport, setGenerating] = useState(false);
  const inputRef                      = useRef<HTMLInputElement>(null);
  const dropRef                       = useRef<HTMLDivElement>(null);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setResult(null); }
  }

  async function scan() {
    if (!file) return;
    setScanning(true);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post(`${API_BASE_URL}/share/forensics/attribute-leak`, form);
      setResult(data as AttributionResult);
      if ((data as any).found) {
        toast.success('Watermark detected — source identified!');
      } else {
        toast('No PINIT-DNA watermark found in this file', { icon: '🔍' });
      }
    } catch { toast.error('Scan failed — check file format'); }
    finally { setScanning(false); }
  }

  async function downloadReport() {
    if (!result?.watermarkCode) return;
    setGenerating(true);
    const toastId = toast.loading('Building attribution report…');
    try {
      const payload: Record<string, string> = {
        type:          'LEAK_ATTRIBUTION',
        watermarkCode: result.watermarkCode,
      };
      if (result.attribution?.shareLink) {
        const sl = result.attribution.shareLink as any;
        if (sl.id)  payload['shareLinkId'] = sl.id;
      }
      const res = await api.post(`${API_BASE_URL}/evidence/report`, payload, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: 'application/pdf' }));
      const a   = document.createElement('a');
      a.href = url; a.download = `PINIT-DNA-LeakAttribution-${result.watermarkCode}.pdf`; a.click();
      URL.revokeObjectURL(url);
      toast.success('Attribution report downloaded', { id: toastId });
    } catch { toast.error('Report failed', { id: toastId }); }
    finally { setGenerating(false); }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 flex gap-3">
        <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-300/80">
          <p className="font-semibold mb-0.5">Leak Attribution Scanner</p>
          Upload a file suspected to be a leaked copy — PINIT-DNA will extract the invisible watermark and identify exactly who received it.
        </div>
      </div>

      {/* Drop zone */}
      <div
        ref={dropRef}
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-bg-border rounded-xl p-10 text-center cursor-pointer hover:border-dna-500/50 hover:bg-dna-500/5 transition-all group"
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.docx"
          onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setResult(null); } }}
        />
        {file ? (
          <div className="space-y-2">
            <div className="text-4xl">
              {file.type === 'application/pdf' ? '📄'
               : file.type.startsWith('image/') ? '🖼️'
               : file.type.includes('word') ? '📝' : '📁'}
            </div>
            <p className="text-sm font-medium text-white">{file.name}</p>
            <p className="text-xs text-gray-500">
              {(file.size / 1024).toFixed(1)} KB · {file.type}
            </p>
            <p className="text-2xs text-gray-600">Click to change file</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Upload size={32} className="mx-auto text-gray-600 group-hover:text-dna-500 transition-colors" />
            <div>
              <p className="text-sm font-medium text-gray-300">Drop leaked file here</p>
              <p className="text-xs text-gray-600 mt-1">PDF, JPEG, PNG, WEBP, or DOCX</p>
            </div>
          </div>
        )}
      </div>

      {file && !result && (
        <button
          onClick={scan}
          disabled={scanning}
          className="w-full btn btn-primary gap-2"
        >
          {scanning ? (
            <><RefreshCw size={14} className="animate-spin" /> Scanning for watermarks…</>
          ) : (
            <><Target size={14} /> Scan & Attribute Leak</>
          )}
        </button>
      )}

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-xl border overflow-hidden ${
              result.found ? 'border-red-500/40' : 'border-green-500/30'
            }`}
          >
            {/* Header */}
            <div className={`px-5 py-4 flex items-center gap-3 ${
              result.found ? 'bg-red-500/10' : 'bg-green-500/10'
            }`}>
              {result.found ? (
                <Target size={20} className="text-red-400" />
              ) : (
                <CheckCircle2 size={20} className="text-green-400" />
              )}
              <div>
                <p className={`font-bold text-sm ${result.found ? 'text-red-300' : 'text-green-300'}`}>
                  {result.found ? '🚨 Watermark Matched — Source Identified' : '✅ No Watermark Detected'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {result.found
                    ? `Extraction method: ${result.extractionMethod} · Confidence: ${result.confidence}%`
                    : 'This file does not contain a PINIT-DNA invisible watermark'}
                </p>
              </div>
            </div>

            {result.found && result.attribution && (
              <div className="px-5 py-4 space-y-4 bg-bg-card">
                {/* Watermark code */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Watermark Code</p>
                    <p className="text-lg font-bold mono text-purple">{result.watermarkCode}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 mb-1">Attribution Confidence</p>
                    <p className="text-2xl font-bold text-green-400">{result.confidence}%</p>
                  </div>
                </div>

                {/* Recipient */}
                {result.attribution.recipientProfile && (
                  <div className="bg-bg-elevated border border-bg-border rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1">
                      <Fingerprint size={11} /> Identified Recipient
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-gray-600">Recipient ID</p>
                        <p className="text-dna-400 font-bold mono mt-0.5">
                          {result.attribution.recipientProfile.recipientCode}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600">Total Sessions</p>
                        <p className="text-gray-300 mt-0.5">
                          {result.attribution.recipientProfile.totalSessions}
                        </p>
                      </div>
                      {result.attribution.recipientProfile.countries.length > 0 && (
                        <div>
                          <p className="text-gray-600">Countries</p>
                          <p className="text-gray-300 mt-0.5">
                            {result.attribution.recipientProfile.countries.join(', ')}
                          </p>
                        </div>
                      )}
                      <div>
                        <p className="text-gray-600">Last Seen</p>
                        <p className="text-gray-300 mono mt-0.5">
                          {formatDistanceToNow(new Date(result.attribution.recipientProfile.lastSeen), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Generate report */}
                <button
                  onClick={downloadReport}
                  disabled={generatingReport}
                  className="w-full btn gap-2 bg-dna-500/10 border border-dna-500/30 text-dna-400 hover:bg-dna-500/20"
                >
                  {generatingReport ? (
                    <><RefreshCw size={13} className="animate-spin" /> Generating…</>
                  ) : (
                    <><Download size={13} /> Download Full Attribution Report (PDF)</>
                  )}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SecurityCenterPage() {
  const [tab, setTab]               = useState<TabId>('incidents');
  const [stats, setStats]           = useState<{
    totalIncidents: number; openIncidents: number; criticalIncidents: number;
    totalRecipients: number; totalEvidence: number; leakedWatermarks: number;
  } | null>(null);

  // Load summary stats
  useState(() => {
    async function loadStats() {
      try {
        const [incRes, recRes, evRes] = await Promise.all([
          api.get(`${API_BASE_URL}/evidence/incidents?limit=1000`),
          api.get(`${API_BASE_URL}/evidence/recipients?limit=1`),
          api.get(`${API_BASE_URL}/evidence/records?limit=1`),
        ]);
        const incs: Incident[] = (incRes.data as any).incidents ?? [];
        setStats({
          totalIncidents:   (incRes.data as any).total ?? 0,
          openIncidents:    incs.filter(i => i.status === 'OPEN').length,
          criticalIncidents:incs.filter(i => i.severity === 'CRITICAL').length,
          totalRecipients:  (recRes.data as any).total ?? 0,
          totalEvidence:    (evRes.data as any).total ?? 0,
          leakedWatermarks: 0,
        });
      } catch { /* non-fatal */ }
    }
    loadStats();
  });

  return (
    <div className="space-y-6 animate-fade-in max-w-[1200px]">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert size={20} className="text-red-400" />
            <h1 className="text-xl font-bold text-white">Security Center</h1>
          </div>
          <p className="text-sm text-gray-500">
            Incident management · Evidence packages · Recipient tracking · Leak attribution
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-gray-600 mono uppercase tracking-wider">Phase 2 Intelligence</span>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard
            icon={<AlertOctagon size={16} className="text-red-400" />}
            color="bg-red-500/15"
            label="Total Incidents"
            value={stats.totalIncidents}
            sub={`${stats.openIncidents} open`}
          />
          <StatCard
            icon={<AlertTriangle size={16} className="text-orange-400" />}
            color="bg-orange-500/15"
            label="Critical"
            value={stats.criticalIncidents}
            sub="highest severity"
          />
          <StatCard
            icon={<FileText size={16} className="text-blue-400" />}
            color="bg-blue-500/15"
            label="Evidence Records"
            value={stats.totalEvidence}
            sub="auto-generated"
          />
          <StatCard
            icon={<Users size={16} className="text-dna-400" />}
            color="bg-dna-500/15"
            label="Recipients Tracked"
            value={stats.totalRecipients}
            sub="REC-XXXX profiles"
          />
          <StatCard
            icon={<Shield size={16} className="text-green-400" />}
            color="bg-green-500/15"
            label="Watermarks Issued"
            value="—"
            sub="per-file invisible marks"
          />
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-bg-border pb-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all ${
              tab === id
                ? 'border-dna-500 text-dna-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'incidents'  && <IncidentsTab />}
          {tab === 'evidence'   && <EvidenceTab />}
          {tab === 'recipients' && <RecipientsTab />}
          {tab === 'scanner'    && <LeakScannerTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
