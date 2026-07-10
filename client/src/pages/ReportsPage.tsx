import { useState, useEffect, useCallback } from 'react';
import { Shield, Search, Eye, Download, FileText, Table2, AlertTriangle, CheckCircle2, GitCompare, Microscope } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { Badge, ClassificationBadge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { cn } from '../components/ui/utils';
import type { ComparisonResult } from '../types/dashboard.types';
import { classifyTampering, SEVERITY_COLOR } from '../services/forensic-analysis';
import { exportComparisonJSON, exportComparisonCSV, exportComparisonPDF } from '../services/report-generator';
import {
  listForensicReports,
  FORENSIC_REPORTS_UPDATED_EVENT,
  type StoredForensicReport,
  type StoredInvestigationReport,
} from '../lib/forensic-reports-storage';
import {
  investigationDisplayMessage,
  investigationDisplayScore,
  investigationListSubtitle,
  investigationScoreLabel,
  investigationVerdictColor,
  investigationVerdictLabel,
  resolveInvestigationOwner,
} from '../lib/forensic-report-display';
import { downloadInvestigationReportPdf, type InvestigationReportExport } from '../services/investigation-report-export';
import toast from 'react-hot-toast';

function matchesFilter(entry: StoredForensicReport, filter: string): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'INVESTIGATION') return entry.kind === 'investigation';
  if (entry.kind !== 'comparison') return false;
  return entry.data.classification === filter;
}

function matchesSearch(entry: StoredForensicReport, search: string): boolean {
  const q = search.toLowerCase();
  if (!q) return true;
  if (entry.kind === 'comparison') {
    const r = entry.data;
    return (
      r.fileA.filename.toLowerCase().includes(q) ||
      r.fileB.filename.toLowerCase().includes(q) ||
      r.comparisonId.toLowerCase().includes(q)
    );
  }
  const r = entry.data;
  return (
    entry.filename.toLowerCase().includes(q) ||
    r.investigationId.toLowerCase().includes(q) ||
    (r.owner?.originalFilename?.toLowerCase().includes(q) ?? false) ||
    (r.owner?.ownerPinitId?.toLowerCase().includes(q) ?? false) ||
    (r.message?.toLowerCase().includes(q) ?? false)
  );
}

function ExportMenu({ result }: { result: ComparisonResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="btn-ghost btn-icon text-gray-500 hover:text-dna-400">
        <Download size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-44 bg-bg-card border border-bg-border rounded-xl shadow-2xl overflow-hidden" onMouseLeave={() => setOpen(false)}>
          {[
            { icon: <FileText size={13} />, label: 'PDF Report', action: async () => { toast.loading('Generating PDF…'); try { await exportComparisonPDF(result); toast.dismiss(); toast.success('PDF downloaded'); } catch { toast.dismiss(); toast.error('PDF failed'); } } },
            { icon: <Download size={13} />, label: 'JSON Report', action: () => { exportComparisonJSON(result); toast.success('JSON exported'); } },
            { icon: <Table2 size={13} />,   label: 'CSV Report',  action: () => { exportComparisonCSV(result); toast.success('CSV exported'); } },
          ].map(item => (
            <button key={item.label} onClick={() => { setOpen(false); item.action(); }}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 text-xs text-gray-300 hover:bg-bg-elevated hover:text-white transition-colors">
              {item.icon}{item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ComparisonDetailModal({ result, onClose }: { result: ComparisonResult; onClose: () => void }) {
  const classColor = {
    DNA_MATCH: 'text-success', SIMILAR: 'text-warning', DIFFERENT: 'text-danger',
  }[result.classification];

  return (
    <Modal open title="DNA Comparison Report" onClose={onClose} size="xl">
      <div className="p-6 space-y-4">
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

        <div className="bg-bg-elevated rounded-xl border border-dna-500/20 p-4">
          <p className="text-2xs font-semibold text-dna-400 uppercase tracking-wider mb-1">Recommendation</p>
          <p className="text-sm text-gray-300">{result.forensicReport.recommendation}</p>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={() => { exportComparisonJSON(result); }} className="btn btn-secondary flex-1">
            <Download size={14} /> Export JSON
          </button>
          <button onClick={onClose} className="btn btn-ghost">Close</button>
        </div>
      </div>
    </Modal>
  );
}

function InvestigationDetailModal({
  report,
  filename,
  onClose,
}: {
  report: StoredInvestigationReport;
  filename: string;
  onClose: () => void;
}) {
  const verdict = investigationVerdictLabel(report);
  const score = investigationDisplayScore(report);
  const scoreLabel = investigationScoreLabel(report);
  const displayMessage = investigationDisplayMessage(report);
  const layers = (report as { layerAnalysis?: Array<{ layer: number; name: string; matchPercent: number; status: string; explanation: string }> }).layerAnalysis ?? [];
  const timeline = report.timeline ?? [];
  const evidenceTimeline = report.evidenceTimeline ?? [];
  const ownerFields = resolveInvestigationOwner(report);
  const dnaPct = report.summary?.dnaMatchPercent;

  return (
    <Modal open title="Unified Investigation Report" onClose={onClose} size="xl">
      <div className="p-6 space-y-4">
        <div className={cn(
          'rounded-xl border p-4',
          verdict === 'VERIFIED' ? 'border-success/30 bg-success/5'
            : verdict === 'POSSIBLE' ? 'border-warning/30 bg-warning/5'
            : 'border-danger/30 bg-danger/5'
        )}>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Badge variant="purple">INVESTIGATION</Badge>
            <Badge variant={verdict === 'VERIFIED' ? 'success' : verdict === 'POSSIBLE' ? 'warning' : 'danger'}>
              {verdict}
            </Badge>
            {report.summary?.riskLevel && (
              <Badge variant="muted">Risk: {report.summary.riskLevel}</Badge>
            )}
            {report.summary?.identityStatus && (
              <Badge variant="muted">Identity: {report.summary.identityStatus.replace(/_/g, ' ')}</Badge>
            )}
          </div>
          <div className="flex items-center gap-4 mb-2">
            <span className={`text-3xl font-bold mono ${investigationVerdictColor(verdict)}`}>{score}%</span>
            <div>
              <p className="text-sm font-semibold text-white">{scoreLabel}</p>
              {typeof dnaPct === 'number' && dnaPct < 40 && score > 0 && (
                <p className="text-2xs text-gray-500">DNA layer compare: {dnaPct}% (partial)</p>
              )}
              <p className="text-2xs text-gray-500 mono">{report.investigationId}</p>
            </div>
          </div>
          {displayMessage && <p className="text-sm text-gray-300">{displayMessage}</p>}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ['Retrieval', report.summary?.retrievalConfidence],
            ['Ownership', report.summary?.ownershipConfidence],
            ['DNA Match', dnaPct],
            ['Trust', report.summary?.trustScore],
          ].map(([label, value]) => (
            typeof value === 'number' ? (
              <div key={label as string} className="bg-bg-elevated rounded-lg p-2.5 text-center">
                <p className="text-lg font-bold mono text-dna-400">{Math.round(value)}%</p>
                <p className="text-2xs text-gray-500">{label}</p>
              </div>
            ) : null
          ))}
        </div>

        <div className="bg-bg-elevated rounded-lg p-3">
          <p className="text-2xs text-gray-500 mb-1">Investigated File</p>
          <p className="text-sm font-medium text-white truncate">{filename}</p>
          {(ownerFields.ownerPinitId || ownerFields.ownerName) && (
            <p className="text-xs text-gray-400 mt-1 mono">
              Owner: {ownerFields.ownerName ?? ownerFields.ownerPinitId}
              {ownerFields.ownerName && ownerFields.ownerPinitId ? ` (${ownerFields.ownerPinitId})` : ''}
            </p>
          )}
          {ownerFields.vaultId && (
            <p className="text-2xs text-gray-500 mt-1 mono truncate">
              Vault: {ownerFields.vaultId}
            </p>
          )}
          {ownerFields.originalFilename && (
            <p className="text-2xs text-gray-500 mt-0.5 truncate">
              Original: {ownerFields.originalFilename}
            </p>
          )}
        </div>

        {timeline.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Session Timeline ({timeline.length})
            </p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {timeline.slice(0, 8).map((ev, i) => (
                <div key={`${ev.stage}-${i}`} className="rounded-lg border border-bg-border bg-bg-elevated px-3 py-2">
                  <p className="text-xs font-medium text-white">{ev.stage}</p>
                  <p className="text-2xs text-gray-500 truncate">{ev.detail ?? ev.timestamp ?? '—'}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {evidenceTimeline.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Evidence Timeline ({evidenceTimeline.length})
            </p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {evidenceTimeline.slice(0, 5).map((ev) => (
                <div key={ev.timestamp + ev.eventType} className="rounded-lg border border-bg-border bg-bg-elevated px-3 py-2">
                  <p className="text-xs font-medium text-white">{ev.eventType}</p>
                  <p className="text-2xs text-gray-500 truncate">{ev.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {layers.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Layer Analysis</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {layers.map(l => (
                <div key={l.layer} className="rounded-lg border border-bg-border bg-bg-elevated p-3 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-white">L{l.layer} · {l.name}</p>
                    <p className="text-2xs text-gray-500">{l.explanation}</p>
                  </div>
                  <span className="text-sm font-bold mono text-dna-400">{l.matchPercent}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={async () => {
              toast.loading('Generating PDF…');
              try {
                await downloadInvestigationReportPdf(report as unknown as InvestigationReportExport);
                toast.dismiss();
                toast.success('PDF downloaded');
              } catch {
                toast.dismiss();
                toast.error('PDF failed');
              }
            }}
            className="btn btn-secondary flex-1"
          >
            <Download size={14} /> Export PDF
          </button>
          <button onClick={onClose} className="btn btn-ghost">Close</button>
        </div>
      </div>
    </Modal>
  );
}

export function ReportsPage() {
  const [reports, setReports] = useState<StoredForensicReport[]>(() => listForensicReports());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('ALL');
  const [selectedComparison, setSelectedComparison] = useState<ComparisonResult | null>(null);
  const [selectedInvestigation, setSelectedInvestigation] = useState<{ report: StoredInvestigationReport; filename: string } | null>(null);

  const reload = useCallback(() => setReports(listForensicReports()), []);

  useEffect(() => {
    reload();
    const onUpdate = () => reload();
    const onFocus = () => reload();
    window.addEventListener(FORENSIC_REPORTS_UPDATED_EVENT, onUpdate);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener(FORENSIC_REPORTS_UPDATED_EVENT, onUpdate);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

  const filtered = reports.filter(r => matchesFilter(r, filter) && matchesSearch(r, search));
  const investigationCount = reports.filter(r => r.kind === 'investigation').length;
  const comparisonCount = reports.filter(r => r.kind === 'comparison').length;

  return (
    <div className="page-shell space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Forensic Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Unified investigations and DNA comparison analysis
          </p>
        </div>
        <div className="flex items-center gap-2">
          {investigationCount > 0 && (
            <Badge variant="dna">{investigationCount} investigations</Badge>
          )}
          {comparisonCount > 0 && (
            <Badge variant="cyan">{comparisonCount} comparisons</Badge>
          )}
          <Badge variant="purple">{reports.length} total</Badge>
        </div>
      </div>

      {reports.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {['ALL', 'INVESTIGATION', 'DNA_MATCH', 'SIMILAR', 'DIFFERENT'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                filter === f
                  ? 'bg-dna-500/20 border-dna-500/40 text-dna-400'
                  : 'border-bg-border text-gray-500 hover:text-white'
              }`}
            >
              {f.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      {reports.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Shield}
            title="No forensic reports yet"
            description="Run a unified investigation or DNA comparison to generate a forensic report"
            action={
              <div className="flex gap-2">
                <Link to="/unified-investigation" className="btn btn-primary btn-sm">
                  <Shield size={14} /> Start Investigation
                </Link>
                <Link to="/compare" className="btn btn-secondary btn-sm">
                  <GitCompare size={14} /> Compare DNA
                </Link>
              </div>
            }
          />
        </div>
      ) : (
        <>
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

          <div className="grid gap-3">
            {filtered.map(entry => {
              if (entry.kind === 'investigation') {
                const r = entry.data;
                const verdict = investigationVerdictLabel(r);
                const score = investigationDisplayScore(r);
                const subtitle = investigationListSubtitle(r, entry.filename);
                const o = resolveInvestigationOwner(r);
                return (
                  <div
                    key={entry.id}
                    className="card-hover"
                    onClick={() => setSelectedInvestigation({ report: r, filename: entry.filename })}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <Badge variant="purple"><Microscope size={10} className="inline mr-1" />INVESTIGATION</Badge>
                          <Badge variant={verdict === 'VERIFIED' ? 'success' : verdict === 'POSSIBLE' ? 'warning' : 'danger'}>
                            {verdict}
                          </Badge>
                          <span className="text-2xs text-gray-500 mono">
                            {format(new Date(entry.savedAt), 'MMM d, yyyy · HH:mm')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300 truncate">{entry.filename}</p>
                        {(o.ownerPinitId || o.vaultId) && (
                          <p className="text-2xs text-dna-400 mono mt-0.5 truncate">
                            {[o.ownerPinitId, o.vaultId ? `Vault ${o.vaultId.slice(0, 8)}…` : null].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">
                          {subtitle}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <span className={`text-2xl font-bold mono ${investigationVerdictColor(verdict)}`}>
                          {score}%
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); setSelectedInvestigation({ report: r, filename: entry.filename }); }}
                          className="btn-ghost btn-icon text-gray-500 hover:text-white"
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              const r = entry.data;
              const cls = classifyTampering(r);
              const sc = SEVERITY_COLOR[cls.severity] ?? SEVERITY_COLOR.NONE;
              return (
                <div
                  key={entry.id}
                  className="card-hover"
                  onClick={() => setSelectedComparison(r)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="cyan"><GitCompare size={10} className="inline mr-1" />COMPARISON</Badge>
                        <ClassificationBadge value={r.classification} />
                        {r.tamperingDetected && (
                          <Badge variant="danger" dot>Tampering Detected</Badge>
                        )}
                        <span className={cn('text-2xs font-semibold px-2 py-0.5 rounded-full border', sc.bg, sc.border, sc.text)}>
                          {cls.severity} · {cls.primaryClass}
                        </span>
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
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setSelectedComparison(r)} className="btn-ghost btn-icon text-gray-500 hover:text-white">
                          <Eye size={14} />
                        </button>
                        <ExportMenu result={r} />
                      </div>
                    </div>
                  </div>

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
              );
            })}
          </div>
        </>
      )}

      {selectedComparison && (
        <ComparisonDetailModal result={selectedComparison} onClose={() => setSelectedComparison(null)} />
      )}
      {selectedInvestigation && (
        <InvestigationDetailModal
          report={selectedInvestigation.report}
          filename={selectedInvestigation.filename}
          onClose={() => setSelectedInvestigation(null)}
        />
      )}
    </div>
  );
}
