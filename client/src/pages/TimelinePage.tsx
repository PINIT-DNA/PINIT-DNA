/**
 * PINIT-DNA — File Timeline & History (Phase 4.3)
 * Route: /timeline
 *
 * Reads DNA records + vault records + session comparison reports.
 * Builds a chronological audit trail per file.
 * DOES NOT modify any existing logic.
 */

import { useState, useMemo } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Clock, Dna, Lock, Search, GitCompare, Award,
  Shield, RefreshCw, Filter, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { listDnaRecords, listVaultRecords, deriveFileType } from '../services/dashboard.api';
import { FileTypeBadge, Badge } from '../components/ui/Badge';
import { SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { cn } from '../components/ui/utils';
import type { DnaRecord, VaultRecord, ComparisonResult } from '../types/dashboard.types';

// ─── Event types ──────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  timestamp: string;
  type: 'DNA_GENERATED' | 'VAULT_STORED' | 'COMPARED' | 'CERTIFICATE';
  title: string;
  detail: string;
  icon: React.ReactNode;
  color: string;
  meta?: Record<string, string>;
}

interface FileHistory {
  filename: string;
  fileType: string;
  dnaRecordId: string;
  vaultId: string | null;
  events: AuditEvent[];
  lastActivity: string;
}

// ─── Build history from available data ────────────────────────────────────────

function buildHistory(
  dnaRecords: DnaRecord[],
  vaultRecords: VaultRecord[],
  comparisons: ComparisonResult[]
): FileHistory[] {
  const vaultByDna = new Map(vaultRecords.map(v => [v.dnaRecordId, v]));
  const histories: FileHistory[] = [];

  for (const r of dnaRecords) {
    const vault = vaultByDna.get(r.id);
    const events: AuditEvent[] = [];

    // DNA Generated
    events.push({
      id: `dna-${r.id}`,
      timestamp: r.createdAt,
      type: 'DNA_GENERATED',
      title: '6-Layer DNA Fingerprint Generated',
      detail: `${r.status} · ${deriveFileType(r)} · ${Math.round(r.imageSizeBytes / 1024)} KB`,
      icon: <Dna size={14} />, color: 'bg-dna-500/20 border-dna-500/40 text-dna-400',
      meta: { 'DNA Record ID': r.id, Status: r.status, 'Engine': r.engineVersion ?? '1.0.0' },
    });

    // Vault stored
    if (vault) {
      events.push({
        id: `vault-${vault.id}`,
        timestamp: vault.createdAt,
        type: 'VAULT_STORED',
        title: 'AES-256-GCM Encrypted & Vaulted',
        detail: `${vault.encryptionAlgorithm} · ${Math.round(vault.encryptedSizeBytes / 1024)} KB encrypted`,
        icon: <Lock size={14} />, color: 'bg-success/20 border-success/40 text-success',
        meta: { 'Vault ID': vault.id, Encryption: vault.encryptionAlgorithm, 'Key Derivation': vault.keyDerivation },
      });

      // Certificate (if vaulted)
      events.push({
        id: `cert-${vault.id}`,
        timestamp: vault.createdAt,
        type: 'CERTIFICATE',
        title: 'Ownership Certificate Available',
        detail: `CERT-DNA-${vault.id.slice(0, 8).toUpperCase()} · Available for download`,
        icon: <Award size={14} />, color: 'bg-purple/20 border-purple/40 text-purple',
        meta: { 'Certificate ID': `CERT-DNA-${vault.id.slice(0, 8).toUpperCase()}` },
      });
    }

    // Comparisons involving this DNA record
    for (const c of comparisons) {
      const involved = c.fileA.filename === r.imageFilename || c.fileB.filename === r.imageFilename;
      if (involved) {
        events.push({
          id: `cmp-${c.comparisonId}-${r.id}`,
          timestamp: c.comparedAt,
          type: 'COMPARED',
          title: `DNA Comparison · ${c.classification.replace('_', ' ')}`,
          detail: `${c.overallConfidenceScore}% confidence · ${c.tamperingDetected ? 'Tampering detected' : 'No tampering'}`,
          icon: <GitCompare size={14} />, color: 'bg-cyan/20 border-cyan/40 text-cyan',
          meta: {
            'Comparison ID': c.comparisonId.slice(0, 12),
            Classification: c.classification,
            Confidence: `${c.overallConfidenceScore}%`,
          },
        });
      }
    }

    // Sort events chronologically
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const lastActivity = events.length > 0 ? events[events.length - 1].timestamp : r.createdAt;

    histories.push({
      filename: r.imageFilename,
      fileType: deriveFileType(r),
      dnaRecordId: r.id,
      vaultId: vault?.id ?? null,
      events,
      lastActivity,
    });
  }

  // Sort by most recent activity
  return histories.sort((a, b) =>
    new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );
}

function getStoredComparisons(): ComparisonResult[] {
  try { return JSON.parse(sessionStorage.getItem('pinit_dna_reports') ?? '[]'); }
  catch { return []; }
}

// ─── File history card ────────────────────────────────────────────────────────

function FileHistoryCard({ history }: { history: FileHistory }) {
  const [expanded, setExpanded] = useState(false);

  const typeColor: Record<string, string> = {
    DNA_GENERATED: 'bg-dna-500/20 border-dna-500/40 text-dna-400',
    VAULT_STORED:  'bg-success/20 border-success/40 text-success',
    COMPARED:      'bg-cyan/20 border-cyan/40 text-cyan',
    CERTIFICATE:   'bg-purple/20 border-purple/40 text-purple',
  };

  const typeIcon: Record<string, React.ReactNode> = {
    DNA_GENERATED: <Dna size={14} />,
    VAULT_STORED:  <Lock size={14} />,
    COMPARED:      <GitCompare size={14} />,
    CERTIFICATE:   <Award size={14} />,
  };

  return (
    <div className="card overflow-hidden p-0">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-bg-elevated/40 transition-colors"
      >
        <FileTypeBadge type={history.fileType} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{history.filename}</p>
          <p className="text-xs text-gray-500 mono mt-0.5">
            {history.dnaRecordId.slice(0, 16)}… · {history.events.length} events
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1">
            {history.events.some(e => e.type === 'VAULT_STORED') && (
              <Badge variant="success">Vaulted</Badge>
            )}
            {history.events.some(e => e.type === 'COMPARED') && (
              <Badge variant="info">Compared</Badge>
            )}
          </div>
          <span className="text-xs text-gray-500">
            {formatDistanceToNow(new Date(history.lastActivity), { addSuffix: true })}
          </span>
          {expanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        </div>
      </button>

      {/* Timeline */}
      {expanded && (
        <div className="border-t border-bg-border px-4 py-4">
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[18px] top-0 bottom-0 w-px bg-bg-border" />

            <div className="space-y-4">
              {history.events.map((event, i) => (
                <div key={event.id} className="relative flex gap-3">
                  {/* Icon bubble */}
                  <div className={cn(
                    'relative z-10 w-9 h-9 rounded-full border flex items-center justify-center shrink-0',
                    typeColor[event.type] ?? 'bg-bg-elevated border-bg-border text-gray-400'
                  )}>
                    {typeIcon[event.type] ?? <Clock size={14} />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pb-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{event.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{event.detail}</p>
                      </div>
                      <span className="text-2xs text-gray-600 mono shrink-0 mt-0.5">
                        {format(new Date(event.timestamp), 'MMM d, HH:mm')}
                      </span>
                    </div>

                    {/* Metadata pills */}
                    {event.meta && Object.keys(event.meta).length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {Object.entries(event.meta).map(([k, v]) => (
                          <div key={k} className="bg-bg-elevated border border-bg-border rounded-lg px-2.5 py-1">
                            <span className="text-2xs text-gray-500">{k}: </span>
                            <span className="text-2xs text-gray-300 mono">{v.length > 20 ? v.slice(0, 20) + '…' : v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Connector dot */}
                  {i < history.events.length - 1 && (
                    <div className="absolute left-[17px] top-9 w-2 h-2 rounded-full bg-bg-border" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TimelinePage() {
  const { data: dnaRecords, loading: loadDna, error: errDna, refetch } = useApi(listDnaRecords);
  const { data: vaultRecords, loading: loadVault }                      = useApi(listVaultRecords);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  const comparisons = useMemo(getStoredComparisons, []);
  const loading = loadDna || loadVault;

  const histories = useMemo(() => {
    if (!dnaRecords || !vaultRecords) return [];
    return buildHistory(dnaRecords, vaultRecords, comparisons);
  }, [dnaRecords, vaultRecords, comparisons]);

  const filtered = useMemo(() => histories.filter(h =>
    (filterType === 'ALL' || h.fileType === filterType) &&
    h.filename.toLowerCase().includes(search.toLowerCase())
  ), [histories, filterType, search]);

  const fileTypes = useMemo(() =>
    ['ALL', ...[...new Set(histories.map(h => h.fileType))]], [histories]);

  const totalEvents = histories.reduce((s, h) => s + h.events.length, 0);

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">File Timeline & Audit Trail</h1>
          <p className="text-sm text-gray-500 mt-0.5">Complete lifecycle history for every registered file</p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && <Badge variant="dna">{histories.length} files · {totalEvents} events</Badge>}
          <button onClick={refetch} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {[
          { color: 'bg-dna-500/20 border-dna-500/40 text-dna-400', icon: <Dna size={12} />, label: 'DNA Generated' },
          { color: 'bg-success/20 border-success/40 text-success', icon: <Lock size={12} />, label: 'Vault Stored' },
          { color: 'bg-cyan/20 border-cyan/40 text-cyan',          icon: <GitCompare size={12} />, label: 'Compared' },
          { color: 'bg-purple/20 border-purple/40 text-purple',    icon: <Award size={12} />, label: 'Certificate' },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <div className={cn('w-6 h-6 rounded-full border flex items-center justify-center', item.color)}>
              {item.icon}
            </div>
            <span className="text-xs text-gray-400">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" placeholder="Search by filename…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="input pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter size={13} className="text-gray-500" />
          {fileTypes.map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={cn(
                'text-xs px-3 py-1.5 rounded-full border transition-all',
                filterType === t
                  ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                  : 'border-bg-border text-gray-500 hover:text-white'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      {!loading && histories.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: <Dna size={16} className="text-dna-400" />, label: 'Files Tracked', value: histories.length },
            { icon: <Lock size={16} className="text-success" />, label: 'Files Vaulted', value: histories.filter(h => h.vaultId).length },
            { icon: <GitCompare size={16} className="text-cyan" />, label: 'Comparisons', value: comparisons.length },
            { icon: <Shield size={16} className="text-purple" />, label: 'Total Events', value: totalEvents },
          ].map(item => (
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

      {/* Timeline */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : errDna ? (
        <div className="card text-center">
          <p className="text-danger text-sm">{errDna}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Clock}
            title="No timeline events"
            description="Generate DNA fingerprints to start building your audit trail"
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(h => (
            <FileHistoryCard key={h.dnaRecordId} history={h} />
          ))}
        </div>
      )}
    </div>
  );
}
