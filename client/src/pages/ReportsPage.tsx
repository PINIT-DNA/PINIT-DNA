import { useState } from 'react';
import { Shield, Search, Eye, Download, AlertTriangle, CheckCircle2, GitCompare } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { Badge, ClassificationBadge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { cn } from '../components/ui/utils';
import type { ComparisonResult } from '../types/dashboard.types';

// Reports are stored in sessionStorage by the compare page
// Key: 'pinit_dna_reports' → JSON array of ComparisonResult
function getStoredReports(): ComparisonResult[] {
  try {
    return JSON.parse(sessionStorage.getItem('pinit_dna_reports') ?? '[]');
  } catch {
    return [];
  }
}

function exportReport(result: ComparisonResult) {
  const report = {
    ...result,
    exportedAt: new Date().toISOString(),
    exportVersion: '2.0.0-universal',
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `forensic-report-${result.comparisonId.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function ReportDetailModal({ result, onClose }: { result: ComparisonResult; onClose: () => void }) {
  const classColor = {
    DNA_MATCH: 'text-success', SIMILAR: 'text-warning', DIFFERENT: 'text-danger',
  }[result.classification];

  return (
    <Modal open title="Forensic Report" onClose={onClose} size="xl">
      <div className="p-6 space-y-4">
        {/* Summary */}
        <div className={cn(
          'rounded-xl border p-4',
          result.classification === 'DNA_MATCH' ? 'border-success/30 bg-success/5'
            : result.classification === 'SIMILAR' ? 'border-warning/30 bg-warning/5'
            : 'border-danger/30 bg-danger/5'
        )}>
          <div className="flex items-center gap-2 mb-3">
            <ClassificationBadge value={result.classification} />
            {result.tamperingDetected && <Badge variant="danger" dot>Tampering Detected</Badge>}
          </div>
          <div className="flex items-center gap-4 mb-2">
            <span className={`text-3xl font-bold ${classColor}`}>{result.overallConfidenceScore}%</span>
            <div>
              <p className="text-sm font-semibold text-white">Confidence Score</p>
              <p className="text-xs text-gray-400">{result.forensicReport.methodology.slice(0, 80)}…</p>
            </div>
          </div>
          <p className="text-sm text-gray-300">{result.forensicReport.summary}</p>
        </div>

        {/* Files */}
        <div className="grid grid-cols-2 gap-3">
          {[result.fileA, result.fileB].map((f, i) => (
            <div key={i} className="bg-bg-elevated rounded-lg p-3">
              <p className="text-2xs text-gray-500 mb-1">File {i === 0 ? 'A' : 'B'}</p>
              <p className="text-sm font-medium text-white truncate">{f.filename}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="dna">{f.fileType}</Badge>
                <span className="text-2xs text-gray-500 mono">{Math.round(f.sizeBytes / 1024)} KB</span>
              </div>
            </div>
          ))}
        </div>

        {/* Layer results */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Layer Analysis</p>
          <div className="space-y-2">
            {result.layerComparisons.map(l => (
              <div key={l.layer} className={cn(
                'rounded-lg border p-3 flex items-center gap-3',
                l.matched ? 'border-bg-border bg-bg-elevated' : 'border-danger/20 bg-danger/5'
              )}>
                {l.matched
                  ? <CheckCircle2 size={14} className="text-success shrink-0" />
                  : <AlertTriangle size={14} className="text-danger shrink-0" />}
                <div className="flex-1">
                  <p className="text-xs font-semibold text-white">L{l.layer} · {l.name}</p>
                  <p className="text-2xs text-gray-500">{l.changeDescription}</p>
                </div>
                <span className={`text-sm font-bold mono ${l.matched ? 'text-success' : 'text-danger'}`}>
                  {l.similarityPercent}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Tampering indicators */}
        {result.forensicReport.tamperingIndicators.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Tampering Indicators</p>
            {result.forensicReport.tamperingIndicators.map((t, i) => (
              <div key={i} className="rounded-lg border border-danger/20 bg-danger/5 p-3 mb-2">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="danger">{t.severity}</Badge>
                  <span className="text-xs font-semibold text-white">{t.description}</span>
                </div>
                <p className="text-2xs text-gray-400">{t.evidence}</p>
              </div>
            ))}
          </div>
        )}

        {/* Recommendation */}
        <div className="bg-bg-elevated rounded-xl border border-dna-500/20 p-4">
          <p className="text-2xs font-semibold text-dna-400 uppercase tracking-wider mb-1">Recommendation</p>
          <p className="text-sm text-gray-300">{result.forensicReport.recommendation}</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button onClick={() => exportReport(result)} className="btn btn-secondary flex-1">
            <Download size={14} /> Export JSON
          </button>
          <button onClick={onClose} className="btn btn-ghost">Close</button>
        </div>
      </div>
    </Modal>
  );
}

export function ReportsPage() {
  const [reports]   = useState<ComparisonResult[]>(getStoredReports);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('ALL');
  const [selected, setSelected] = useState<ComparisonResult | null>(null);

  const filtered = reports.filter(r =>
    (filter === 'ALL' || r.classification === filter) &&
    (r.fileA.filename.toLowerCase().includes(search.toLowerCase()) ||
     r.fileB.filename.toLowerCase().includes(search.toLowerCase()) ||
     r.comparisonId.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Forensic Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">DNA comparison analysis and tampering reports</p>
        </div>
        <Badge variant="purple">{reports.length} reports</Badge>
      </div>

      {/* Filters */}
      {reports.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {['ALL', 'DNA_MATCH', 'SIMILAR', 'DIFFERENT'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                filter === f
                  ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                  : 'border-bg-border text-gray-500 hover:text-white'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
      )}

      {reports.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Shield}
            title="No forensic reports yet"
            description="Run a DNA comparison to generate a forensic analysis report"
            action={
              <Link to="/compare" className="btn btn-primary btn-sm">
                <GitCompare size={14} /> Start Comparison
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search reports…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9 text-sm"
            />
          </div>

          {/* Report cards */}
          <div className="grid gap-3">
            {filtered.map(r => (
              <div
                key={r.comparisonId}
                className="card-hover"
                onClick={() => setSelected(r)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <ClassificationBadge value={r.classification} />
                      {r.tamperingDetected && (
                        <Badge variant="danger" dot>Tampering Detected</Badge>
                      )}
                      <span className="text-2xs text-gray-500 mono">
                        {format(new Date(r.comparedAt), 'MMM d, yyyy · HH:mm')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-300 min-w-0">
                      <span className="truncate max-w-[180px]">{r.fileA.filename}</span>
                      <GitCompare size={12} className="text-gray-600 shrink-0" />
                      <span className="truncate max-w-[180px]">{r.fileB.filename}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5 line-clamp-1">
                      {r.forensicReport.summary}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <span className={`text-2xl font-bold mono ${
                      r.overallConfidenceScore >= 90 ? 'text-success'
                        : r.overallConfidenceScore >= 55 ? 'text-warning'
                        : 'text-danger'
                    }`}>
                      {r.overallConfidenceScore}%
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={e => { e.stopPropagation(); setSelected(r); }}
                        className="btn-ghost btn-icon text-gray-500 hover:text-white"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); exportReport(r); }}
                        className="btn-ghost btn-icon text-gray-500 hover:text-dna-400"
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Changed layers row */}
                {r.changedLayers.length > 0 && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-bg-border">
                    <span className="text-2xs text-gray-600">Changed:</span>
                    {r.changedLayers.map(l => (
                      <Badge key={l} variant="danger">{l}</Badge>
                    ))}
                    {r.matchedLayers.map(l => (
                      <Badge key={l} variant="success">{l}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {selected && <ReportDetailModal result={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
