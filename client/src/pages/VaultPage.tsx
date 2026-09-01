import { useState, useEffect } from 'react';
import { Archive, Search, RefreshCw, Eye, Check, Clock, ShieldCheck, MapPin, LayoutGrid, List, Cpu } from 'lucide-react';
import { VaultFileThumbnail } from '../components/VaultFileThumbnail';
import { VaultDetailSidePanel } from '../components/VaultDetailSidePanel';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { useApi, formatBytes } from '../hooks/useApi';
import {
  listVaultRecords,
  protectedDownloadFromVault,
  deleteVaultRecord,
  api,
} from '../services/dashboard.api';
import { SkeletonTable, SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { cn } from '../components/ui/utils';
import { FILE_TYPES, getVaultFileTypeLabel, getVaultFileTypeDisplay } from '../lib/file-type-utils';
import { API_BASE_URL } from '../config/api.config';
import type { VaultRecord } from '../types/dashboard.types';
import { vaultSourceCaption } from '../lib/source-platform';

// ─── Protected Download Modal ─────────────────────────────────────────────────

const PROTECTED_STEPS = [
  { id: 'ownership', label: 'Checking ownership…' },
  { id: 'dna', label: 'Checking protection…' },
  { id: 'certificate', label: 'Checking certificate…' },
  { id: 'prepare', label: 'Preparing download…' },
  { id: 'ready', label: 'Ready' },
];

function ProtectedDownloadModal({ record, onClose }: { record: VaultRecord; onClose: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [forensicPreserved, setForensicPreserved] = useState(false);
  const [recipientLabel, setRecipientLabel] = useState('');
  const [lastTep, setLastTep] = useState<string | null>(null);

  const runProtectedDownload = async () => {
    setPhase('running');
    setError(null);
    setActiveStep(0);

    const stepTimer = window.setInterval(() => {
      setActiveStep((s) => Math.min(s + 1, PROTECTED_STEPS.length - 2));
    }, 600);

    try {
      const { blob, tepCode, tracking } = await protectedDownloadFromVault(record.id, {
        recipientLabel: recipientLabel.trim() || undefined,
      });
      setForensicPreserved(true);
      setLastTep(tepCode ?? null);
      setActiveStep(PROTECTED_STEPS.length - 2);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = record.originalFileName;
      a.click();
      URL.revokeObjectURL(url);

      setActiveStep(PROTECTED_STEPS.length - 1);
      setPhase('done');
      toast.success(
        tepCode
          ? `Protected download complete — TEP ${tepCode} (${tracking ?? 'tracked'})`
          : 'Protected download complete — download event recorded',
      );
    } catch (err) {
      setPhase('error');
      const msg = err instanceof Error ? err.message : 'Protected download failed';
      setError(msg);
      toast.error(msg.length > 80 ? 'Protected download failed' : msg);
    } finally {
      window.clearInterval(stepTimer);
    }
  };

  return (
    <Modal open title="Protected download" onClose={onClose} size="md">
      <div className="space-y-4">
        <div className="rounded-xl bg-dna-500/10 border border-dna-500/30 p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck size={16} className="text-dna-400" />
            <p className="text-sm font-semibold text-white">{record.originalFileName}</p>
          </div>
          <p className="text-xs text-gray-400 mb-2">
            Download with tracking so you can see who received the file. Opening outside Pinit may still
            be identified later through Investigate.
          </p>
          <ul className="text-xs text-dna-300 space-y-0.5">
            <li>✓ Tracked delivery</li>
            <li>✓ Visible watermark</li>
            <li>✓ Download log (time / device)</li>
            <li>✓ Activity history</li>
            <li>✓ Later match via Investigate</li>
          </ul>
        </div>

        {phase === 'idle' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">Recipient (optional label)</label>
              <input
                className="input text-sm mt-1"
                placeholder="e.g. HR team / self"
                value={recipientLabel}
                onChange={(e) => setRecipientLabel(e.target.value)}
              />
            </div>
          </div>
        )}

        <ul className="space-y-2">
          {PROTECTED_STEPS.map((step, i) => {
            const done = phase === 'done' ? true : i < activeStep;
            const current = phase === 'running' && i === activeStep;
            return (
              <li
                key={step.id}
                className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
                  done ? 'bg-success/10 text-success' : current ? 'bg-dna-500/10 text-dna-300' : 'bg-bg-elevated text-gray-500'
                }`}
              >
                {done ? <Check size={14} /> : current ? <RefreshCw size={14} className="animate-spin" /> : <Clock size={14} />}
                {step.label}
              </li>
            );
          })}
        </ul>

        {phase === 'done' && forensicPreserved && (
          <div className="text-xs text-success text-center space-y-1">
            <p>Protected download recorded in chain of custody.</p>
            {lastTep && <p className="text-dna-300 text-xs">Tracking code {lastTep}</p>}
          </div>
        )}

        {error && (
          <p className="text-xs text-danger text-center">{error}</p>
        )}

        <div className="flex gap-3 pt-2">
          {phase === 'idle' || phase === 'error' ? (
            <button onClick={runProtectedDownload} className="btn btn-primary flex-1">
              <ShieldCheck size={14} /> Download with tracking
            </button>
          ) : phase === 'running' ? (
            <button disabled className="btn btn-primary flex-1 opacity-70">
              <RefreshCw size={14} className="animate-spin" /> Processing…
            </button>
          ) : (
            <button onClick={onClose} className="btn btn-primary flex-1">Done</button>
          )}
          {phase !== 'running' && (
            <button onClick={onClose} className="btn btn-secondary">Close</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function VaultGalleryCard({
  record,
  selected,
  onSelect,
}: {
  record: VaultRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const source = vaultSourceCaption(record);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'card overflow-hidden p-0 text-left transition-all duration-200 hover:border-dna-500/35 hover:-translate-y-0.5',
        selected && 'ring-2 ring-dna-500/55 border-dna-500/40',
      )}
    >
      <div className="w-full aspect-[4/3] bg-bg-elevated relative overflow-hidden">
        <VaultFileThumbnail
          vaultId={record.id}
          fileName={record.originalFileName}
          mimeType={record.originalMimeType}
          variant="gallery"
        />
        {source && (
          <span className="absolute top-2 left-2 text-2xs font-semibold px-1.5 py-0.5 rounded-md bg-black/65 text-white border border-white/15">
            {source}
          </span>
        )}
      </div>
      <div className="p-3 space-y-1">
        <p className="text-sm font-semibold text-white truncate">{record.originalFileName}</p>
        <p className="text-xs text-gray-500 truncate">
          {getVaultFileTypeDisplay(record.originalMimeType, record.originalFileName)}
          {source ? ` · ${source}` : ''}
        </p>
        <p className="text-xs text-gray-500">
          {format(new Date(record.createdAt), 'MMM d, yyyy')}
        </p>
      </div>
    </button>
  );
}

export function VaultPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focusId = params.get('id');
  const { data: records, loading, error, refetch, setData: setRecords } = useApi(listVaultRecords, [], { cacheKey: 'vault-records' });
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState<VaultRecord | null>(null);
  const [protecting, setProtecting] = useState<VaultRecord | null>(null);
  const [aiMode, setAiMode]     = useState(false);
  const [aiResults, setAiResults] = useState<string[]>([]); // dnaRecordIds matching AI search
  const [aiSearching, setAiSearching] = useState(false);
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>('gallery');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusId || !records?.length || selected?.id === focusId) return;
    const match = records.find((r) => r.id === focusId);
    if (match) setSelected(match);
  }, [focusId, records, selected?.id]);

  const handleShare = (record: VaultRecord) => {
    setSelected(null);
    setProtecting(null);
    navigate(`/vault/assets/${record.id}/share`);
  };

  const handleRenamed = (vaultId: string, originalFileName: string) => {
    setRecords((prev) =>
      (prev ?? []).map((r) => (r.id === vaultId ? { ...r, originalFileName } : r)),
    );
    setSelected((prev) => (prev?.id === vaultId ? { ...prev, originalFileName } : prev));
  };

  const handleDelete = async (record: VaultRecord) => {
    if (!window.confirm(`Remove "${record.originalFileName}" from Digital Assets?`)) return;
    const previous = records;
    setDeletingId(record.id);
    // Optimistic UI — remove card + close panel immediately
    setRecords((prev) => (prev ?? []).filter((r) => r.id !== record.id));
    if (selected?.id === record.id) setSelected(null);
    if (protecting?.id === record.id) setProtecting(null);
    try {
      await deleteVaultRecord(record.id);
      toast.success('File removed');
    } catch {
      setRecords(previous);
      toast.error('Failed to delete file');
      refetch();
    } finally {
      setDeletingId(null);
    }
  };

  const handleSearch = async (q: string) => {
    setSearch(q);
    if (!aiMode || !q.trim()) { setAiResults([]); return; }
    setAiSearching(true);
    try {
      const { data } = await api.post(`${API_BASE_URL}/ai/search`, {
        query: q.trim(), topK: 20, threshold: 0.30, mode: 'hybrid',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = (data as any).data ?? data;
      setAiResults((payload.results ?? []).map((r: { dnaRecordId: string }) => r.dnaRecordId));
    } catch {
      setAiResults([]);
    } finally {
      setAiSearching(false);
    }
  };

  const filtered = (records ?? []).filter(r => {
    const typeLabel = getVaultFileTypeLabel(r.originalMimeType, r.originalFileName);
    if (typeFilter !== 'ALL' && typeLabel !== typeFilter) return false;

    if (!search) return true;
    const keyword = (
      r.originalFileName.toLowerCase().includes(search.toLowerCase()) ||
      r.id.toLowerCase().includes(search.toLowerCase()) ||
      r.dnaRecordId.toLowerCase().includes(search.toLowerCase()) ||
      (r.sourcePlatform ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (vaultSourceCaption(r) ?? '').toLowerCase().includes(search.toLowerCase())
    );
    if (aiMode && !aiSearching) {
      return aiResults.length > 0 ? aiResults.includes(r.dnaRecordId) : keyword;
    }
    return keyword;
  });

  const typeCounts = (records ?? []).reduce<Record<string, number>>((acc, r) => {
    const label = getVaultFileTypeLabel(r.originalMimeType, r.originalFileName);
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});

  if (error) return (
    <div className="flex items-center justify-center h-64 text-center">
      <div>
        <p className="text-danger text-sm mb-3">{error}</p>
        <button onClick={refetch} className="btn btn-secondary btn-sm">
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    </div>
  );

  return (
    <div className="page-shell animate-fade-in">
      <div className="space-y-5 min-w-0">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 mb-1">Library</p>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Digital Assets</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            All your protected files in one place — Hub uploads and extension captures
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!loading && records && (
            <div className="flex items-center gap-2">
              <Badge variant="purple">{records.length} files</Badge>
              <Badge variant="success" dot>Protected</Badge>
            </div>
          )}
          <button onClick={refetch} disabled={loading} className="btn btn-secondary btn-sm" title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      {!loading && records && records.length > 0 && (
        <div className="stat-grid-3 gap-3">
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-purple tabular-nums">{records.length}</p>
            <p className="text-xs text-gray-500 mt-1">Protected assets</p>
          </div>
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-success tabular-nums">
              {formatBytes(records.reduce((s, r) => s + r.encryptedSizeBytes, 0))}
            </p>
            <p className="text-xs text-gray-500 mt-1">Storage used</p>
          </div>
          <div className="card-sm text-center">
            <p className="text-2xl font-bold text-dna-400">Protected</p>
            <p className="text-xs text-gray-500 mt-1">Only you control access</p>
          </div>
        </div>
      )}

      {/* File type filter bar */}
      {!loading && records && records.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          <button
            type="button"
            onClick={() => setTypeFilter('ALL')}
            className={`shrink-0 px-3 py-2 rounded-lg border text-xs font-semibold transition-all min-h-[40px] ${
              typeFilter === 'ALL'
                ? 'bg-dna-500/15 border-dna-500/40 text-dna-400'
                : 'bg-bg-card border-bg-border text-gray-400 hover:text-white hover:border-dna-500/25'
            }`}
          >
            All · {records.length}
          </button>
          {FILE_TYPES.map(({ label, icon, color }) => {
            const count = typeCounts[label] ?? 0;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setTypeFilter(label)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all min-h-[40px] ${
                  typeFilter === label
                    ? 'bg-dna-500/15 border-dna-500/40 text-dna-400'
                    : 'bg-bg-card border-bg-border text-gray-400 hover:text-white hover:border-dna-500/25'
                }`}
              >
                <span>{icon}</span>
                <span className={typeFilter === label ? '' : color}>{label}</span>
                <span className="mono text-2xs opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Search + table */}
      <div className="card overflow-hidden p-0">
        <div className="toolbar-row p-4 border-b border-bg-border">
          <div className="relative flex-1 min-w-0 w-full">
            {aiSearching
              ? <RefreshCw size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dna-400 animate-spin" />
              : <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />}
            <input
              type="text"
              placeholder={aiMode ? 'Search by meaning or filename…' : 'Search by filename or source…'}
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="input pl-9 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto shrink-0">
            <button
              onClick={() => { setAiMode(m => !m); setSearch(''); setAiResults([]); }}
              title={aiMode ? 'Switch to keyword search' : 'Search by meaning'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all shrink-0 min-h-[44px] sm:min-h-0 ${
                aiMode
                  ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                  : 'border-bg-border text-gray-500 hover:text-white hover:border-gray-600'
              }`}
            >
              <Cpu size={13} />
              {aiMode ? 'Smart search on' : 'Smart search'}
            </button>
            <div className="flex items-center rounded-lg border border-bg-border overflow-hidden shrink-0">
              <button
                onClick={() => setViewMode('gallery')}
                title="Gallery view"
                className={cn(
                  'px-2.5 py-1.5 transition-colors min-h-[44px] sm:min-h-0',
                  viewMode === 'gallery' ? 'bg-dna-500/20 text-dna-400' : 'text-gray-500 hover:text-white',
                )}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                title="List view"
                className={cn(
                  'px-2.5 py-1.5 border-l border-bg-border transition-colors min-h-[44px] sm:min-h-0',
                  viewMode === 'list' ? 'bg-dna-500/20 text-dna-400' : 'text-gray-500 hover:text-white',
                )}
              >
                <List size={14} />
              </button>
            </div>
            <Archive size={16} className="text-gray-500 shrink-0 hidden sm:block" />
          </div>
        </div>

        {viewMode === 'gallery' ? (
          <div className="p-4">
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Archive}
                title="No protected assets yet"
                description="Protect an asset to store it here — then share and track who opens it"
              />
            ) : (
              <div className={cn(
                'grid gap-4',
                selected
                  ? 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-3'
                  : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
              )}>
                {filtered.map(r => (
                  <VaultGalleryCard
                    key={r.id}
                    record={r}
                    selected={selected?.id === r.id}
                    onSelect={() => setSelected(prev => (prev?.id === r.id ? null : r))}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Source</th>
                <th>ID</th>
                <th>Location</th>
                <th>Size</th>
                <th>Status</th>
                <th>Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTable rows={5} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={Archive}
                      title="No protected assets yet"
                      description="Protect an asset to store it here — then share and track who opens it"
                    />
                  </td>
                </tr>
              ) : (
                filtered.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(prev => (prev?.id === r.id ? null : r))}
                    className={cn(
                      'cursor-pointer transition-colors',
                      selected?.id === r.id && 'bg-dna-500/10',
                    )}
                  >
                    <td>
                      <div className="flex items-center gap-2.5">
                        <VaultFileThumbnail
                          vaultId={r.id}
                          fileName={r.originalFileName}
                          mimeType={r.originalMimeType}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate max-w-[200px]">
                            {r.originalFileName}
                          </p>
                          <p className="text-xs text-gray-500">
                            {getVaultFileTypeDisplay(r.originalMimeType, r.originalFileName)}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="text-xs text-gray-300">
                        {vaultSourceCaption(r) ?? 'Pinit HUB'}
                      </span>
                    </td>
                    <td>
                      <span className="mono text-2xs text-dna-400">{r.id.slice(0, 16)}…</span>
                    </td>
                    <td>
                      {r.location?.status === 'AVAILABLE' ? (
                        <div className="flex items-start gap-1 max-w-[160px]">
                          <MapPin size={12} className="text-dna-400 shrink-0 mt-0.5" />
                          <span
                            className="text-xs text-gray-300 truncate"
                            title={[
                              r.location.creationLabel && `Created: ${r.location.creationLabel}`,
                              r.location.sharedLabel && `Shared: ${r.location.sharedLabel}`,
                              (r.location.presentLabel ?? r.location.lastKnownLabel)
                                && `Present: ${r.location.presentLabel ?? r.location.lastKnownLabel}`,
                            ].filter(Boolean).join(' · ')}
                          >
                            {r.location.presentLabel
                              ?? r.location.lastKnownLabel
                              ?? r.location.creationLabel}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">Unavailable</span>
                      )}
                    </td>
                    <td>
                      <span className="mono text-xs">{formatBytes(r.originalSizeBytes)}</span>
                    </td>
                    <td>
                      <Badge variant="success">Protected</Badge>
                    </td>
                    <td>
                      <span className="text-xs text-gray-400">
                        {format(new Date(r.createdAt), 'MMM d, yyyy · HH:mm')}
                      </span>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setSelected(r)}
                        className="btn-ghost btn-sm text-xs text-dna-400"
                      >
                        <Eye size={12} /> Open
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
      </div>

        {selected && (
          <VaultDetailSidePanel
            record={selected}
            onClose={() => setSelected(null)}
            onShare={() => handleShare(selected)}
            onDelete={() => handleDelete(selected)}
            onRenamed={handleRenamed}
            deleting={deletingId === selected.id}
          />
        )}

      {protecting && (
        <ProtectedDownloadModal record={protecting} onClose={() => setProtecting(null)} />
      )}
    </div>
  );
}
