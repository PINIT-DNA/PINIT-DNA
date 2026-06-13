import { api } from '../services/dashboard.api';
/**
 * PINIT-DNA — Vault Integrity Monitoring Dashboard (Phase 4.6)
 * Route: /vault-integrity
 *
 * Calls GET /api/v1/vault/integrity-check and displays results.
 * DOES NOT modify any existing logic.
 */

import { useState } from 'react';
import {
  Shield, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Lock, Activity, HardDrive,
} from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonTable } from '../components/ui/Skeleton';
import { cn } from '../components/ui/utils';
import { formatBytes } from '../hooks/useApi';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntegrityResult {
  vaultId: string;
  filename: string;
  encryptedFilePath: string;
  fileExists: boolean;
  fileSizeMatch: boolean;
  storedSize: number;
  actualSize: number | null;
  status: 'HEALTHY' | 'FILE_MISSING' | 'SIZE_MISMATCH' | 'ERROR';
  checkedAt: string;
}

interface IntegrityReport {
  summary: {
    total: number;
    healthy: number;
    missing: number;
    mismatch: number;
    overallHealth: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  };
  checkedAt: string;
  results: IntegrityResult[];
}

async function runIntegrityCheck(): Promise<IntegrityReport> {
  const { data } = await api.get('/api/v1/vault/integrity-check');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data as any;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CFG = {
  HEALTHY:      { icon: <CheckCircle2 size={14} />, color: 'text-success', badge: 'success' as const,  label: 'Healthy'      },
  FILE_MISSING: { icon: <XCircle size={14} />,      color: 'text-danger',  badge: 'danger' as const,   label: 'File Missing' },
  SIZE_MISMATCH:{ icon: <AlertTriangle size={14} />,color: 'text-warning', badge: 'warning' as const,  label: 'Size Mismatch'},
  ERROR:        { icon: <XCircle size={14} />,      color: 'text-danger',  badge: 'danger' as const,   label: 'Error'        },
};

const HEALTH_CFG = {
  HEALTHY:  { color: 'text-success', bg: 'bg-success/10 border-success/30', label: 'All Systems Healthy' },
  WARNING:  { color: 'text-warning', bg: 'bg-warning/10 border-warning/30', label: 'Warning — Issues Detected' },
  CRITICAL: { color: 'text-danger',  bg: 'bg-danger/10  border-danger/30',  label: 'Critical — Files Missing' },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export function VaultIntegrityPage() {
  const [report,  setReport]  = useState<IntegrityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter,  setFilter]  = useState<'ALL' | 'HEALTHY' | 'FILE_MISSING' | 'SIZE_MISMATCH'>('ALL');

  const handleCheck = async () => {
    setLoading(true);
    try {
      const res = await runIntegrityCheck();
      setReport(res);
      if (res.summary.overallHealth === 'HEALTHY') toast.success('All vault files are healthy');
      else if (res.summary.missing > 0) toast.error(`${res.summary.missing} vault file(s) missing!`);
      else toast.error('Integrity issues detected');
    } catch {
      toast.error('Failed to run integrity check');
    } finally {
      setLoading(false);
    }
  };

  const filtered = report?.results.filter(r => filter === 'ALL' || r.status === filter) ?? [];
  const healthCfg = report ? HEALTH_CFG[report.summary.overallHealth] : null;

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Vault Integrity Monitor</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Verify encrypted files exist on disk and match stored metadata
          </p>
        </div>
        <button
          onClick={handleCheck}
          disabled={loading}
          className="btn btn-primary"
        >
          {loading
            ? <><RefreshCw size={15} className="animate-spin" /> Running checks…</>
            : <><Activity size={15} /> Run Integrity Check</>}
        </button>
      </div>

      {/* Explanation */}
      {!report && !loading && (
        <div className="card">
          <div className="flex gap-4 mb-4">
            <div className="w-10 h-10 rounded-xl bg-dna-500/15 flex items-center justify-center shrink-0">
              <Shield size={18} className="text-dna-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white mb-1">What does this check?</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                For each vault record in the database, this tool verifies that:
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { icon: <HardDrive size={14} className="text-dna-400" />, title: 'File Exists on Disk', desc: 'The .enc encrypted file is present at its stored path' },
              { icon: <Shield size={14} className="text-success" />,    title: 'Size Integrity',       desc: 'File size matches the recorded encrypted size in the database' },
              { icon: <Lock size={14} className="text-purple" />,       title: 'Database Consistency', desc: 'Vault record correctly links to its DNA record' },
            ].map(item => (
              <div key={item.title} className="bg-bg-elevated rounded-xl p-3 border border-bg-border">
                <div className="flex items-center gap-2 mb-1.5">{item.icon} <p className="text-xs font-semibold text-white">{item.title}</p></div>
                <p className="text-2xs text-gray-500">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-center">
            <button onClick={handleCheck} disabled={loading} className="btn btn-primary btn-lg">
              <Activity size={16} /> Start Integrity Check
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card">
          <div className="flex flex-col items-center py-10">
            <RefreshCw size={32} className="text-dna-400 animate-spin mb-4" />
            <p className="text-white font-semibold">Running integrity checks…</p>
            <p className="text-sm text-gray-500 mt-1">Verifying all vault files on disk</p>
          </div>
        </div>
      )}

      {/* Results */}
      {report && !loading && (
        <>
          {/* Health banner */}
          {healthCfg && (
            <div className={cn('rounded-2xl border p-5', healthCfg.bg)}>
              <div className="flex items-center gap-4">
                <div className={`text-3xl font-bold ${healthCfg.color}`}>
                  {report.summary.overallHealth === 'HEALTHY' ? '✓' : report.summary.missing > 0 ? '✗' : '⚠'}
                </div>
                <div>
                  <p className={`text-lg font-bold ${healthCfg.color}`}>{healthCfg.label}</p>
                  <p className="text-sm text-gray-400">
                    {report.summary.total} files checked · {report.summary.healthy} healthy
                    {report.summary.missing > 0 && ` · ${report.summary.missing} missing`}
                    {report.summary.mismatch > 0 && ` · ${report.summary.mismatch} size mismatch`}
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-2xs text-gray-500">Checked at</p>
                  <p className="text-xs text-gray-300 mono">{format(new Date(report.checkedAt), 'PPpp')}</p>
                </div>
              </div>
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Files',   value: report.summary.total,   color: 'text-white',   icon: <HardDrive size={16} className="text-gray-400" /> },
              { label: 'Healthy',       value: report.summary.healthy,  color: 'text-success', icon: <CheckCircle2 size={16} className="text-success" /> },
              { label: 'Files Missing', value: report.summary.missing,  color: 'text-danger',  icon: <XCircle size={16} className="text-danger" /> },
              { label: 'Size Mismatch', value: report.summary.mismatch, color: 'text-warning', icon: <AlertTriangle size={16} className="text-warning" /> },
            ].map(item => (
              <div key={item.label} className="card-sm flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-bg-elevated flex items-center justify-center">{item.icon}</div>
                <div>
                  <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
                  <p className="text-2xs text-gray-500">{item.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2">
            {(['ALL', 'HEALTHY', 'FILE_MISSING', 'SIZE_MISMATCH'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'text-xs px-3 py-1.5 rounded-full border transition-all',
                  filter === f
                    ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                    : 'border-bg-border text-gray-500 hover:text-white'
                )}
              >
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* Results table */}
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Encrypted File</th>
                    <th>Stored Size</th>
                    <th>Actual Size</th>
                    <th>File Exists</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonTable rows={4} />
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={6}>
                      <EmptyState icon={Shield} title="No results" description="Run integrity check to see results" />
                    </td></tr>
                  ) : (
                    filtered.map(r => {
                      const cfg = STATUS_CFG[r.status] ?? STATUS_CFG.HEALTHY;
                      return (
                        <tr key={r.vaultId}>
                          <td>
                            <p className="text-sm font-medium text-white truncate max-w-[200px]">{r.filename}</p>
                            <p className="text-2xs text-gray-500 mono">{r.vaultId.slice(0, 12)}…</p>
                          </td>
                          <td><span className="text-xs text-gray-400 mono">{r.encryptedFilePath}</span></td>
                          <td><span className="mono text-xs">{formatBytes(r.storedSize)}</span></td>
                          <td>
                            <span className={cn('mono text-xs', r.fileSizeMatch ? 'text-success' : 'text-warning')}>
                              {r.actualSize !== null ? formatBytes(r.actualSize) : '—'}
                            </span>
                          </td>
                          <td>
                            {r.fileExists
                              ? <CheckCircle2 size={15} className="text-success" />
                              : <XCircle size={15} className="text-danger" />}
                          </td>
                          <td>
                            <div className={cn('flex items-center gap-1.5', cfg.color)}>
                              {cfg.icon}
                              <Badge variant={cfg.badge}>{cfg.label}</Badge>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <button onClick={handleCheck} disabled={loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} /> Re-run Check
          </button>
        </>
      )}
    </div>
  );
}
