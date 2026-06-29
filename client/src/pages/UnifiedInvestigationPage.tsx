import { useState, useRef, useCallback } from 'react';
import {
  Shield, Upload, CheckCircle, AlertTriangle, RefreshCw, ScanLine,
  ChevronDown, ChevronUp, Fingerprint, Dna, User, Clock, Activity,
  FileDown, Globe, Lock, Eye, Download, Microscope,
} from 'lucide-react';
import { unifiedInvestigate } from '../services/dashboard.api';
import { cn } from '../components/ui/utils';
import { DocumentScanner } from '../components/DocumentScanner';
import {
  downloadInvestigationReportPdf,
  downloadDnaReportPdf,
  downloadTimelineReportPdf,
  downloadEvidencePackageZip,
  downloadAdvancedExportJson,
  type InvestigationReportExport,
} from '../services/investigation-report-export';

interface PipelineStep {
  id: string;
  label: string;
  status: 'complete' | 'warning' | 'failed' | 'skipped';
  detail?: string;
}

interface InvestigationReport {
  success: boolean;
  investigationId: string;
  investigatedAt: string;
  pipeline: PipelineStep[];
  summary: {
    ownershipConfidence: number;
    dnaMatchPercent: number;
    certificateStatus: string;
    identityStatus: string;
    tamperSeverity: string;
    riskLevel: string;
  };
  owner: Record<string, string | null | undefined>;
  recipientAttribution: Record<string, unknown>;
  layerAnalysis: Array<{
    layer: number;
    name: string;
    matchPercent: number;
    status: string;
    explanation: string;
  }>;
  tamperAnalysis: {
    primaryVector: string;
    overallTamperScore: number;
    vectors: Array<{ label: string; detected: boolean }>;
    description?: string;
  };
  timeline: Array<{ stage: string; timestamp?: string; detail?: string }>;
  accessIntelligence: Array<Record<string, string | undefined>>;
  leakIntelligence: {
    hasPublicLeak: boolean;
    entries: Array<{ platform: string; url: string; firstSeen?: string; lastSeen?: string; status: string }>;
    message: string;
  };
  identityProof: {
    vaultId?: string;
    dnaRecordId?: string;
    certificateId?: string;
    ownerPinitId?: string;
    digitalSignatureValid: boolean;
    identityVerification: string;
    watermark: {
      status: 'DETECTED' | 'DAMAGED' | 'NOT_EMBEDDED';
      reason?: string;
      code?: string;
      vaultId?: string;
      ownerPinitId?: string;
      confidence?: number;
      extractionMethod?: string;
    };
  };
  dnaComparison?: {
    layerComparisons?: Array<{
      layer: number;
      name: string;
      implementation: string;
      similarityPercent: number;
      matched: boolean;
      changed: boolean;
      fingerprintA: string;
      fingerprintB: string;
      changeDescription: string;
    }>;
    classification?: string;
    overallConfidenceScore?: number;
    fileA?: { filename: string; mimeType: string; sizeBytes: number };
    fileB?: { filename: string; mimeType: string; sizeBytes: number };
  } | null;
  message?: string;
}

const WATERMARK_STATUS_STYLE: Record<string, string> = {
  DETECTED: 'text-green-400 bg-green-500/15 border-green-500/30',
  DAMAGED: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
  NOT_EMBEDDED: 'text-blue-400 bg-blue-500/15 border-blue-500/30',
};

function watermarkDisplayLabel(status: string): string {
  if (status === 'NOT_EMBEDDED') return 'NOT EMBEDDED';
  return status;
}

const RISK_COLORS: Record<string, string> = {
  LOW: 'text-green-400 bg-green-500/10 border-green-500/30',
  MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  HIGH: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  CRITICAL: 'text-red-400 bg-red-500/10 border-red-500/30',
  UNKNOWN: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
};

const LAYER_STATUS: Record<string, string> = {
  verified: 'text-green-400 bg-green-500/15',
  warning: 'text-yellow-400 bg-yellow-500/15',
  failed: 'text-orange-400 bg-orange-500/15',
  skipped: 'text-gray-400 bg-gray-500/15',
};

const STEP_STATUS: Record<string, string> = {
  complete: 'bg-green-500',
  warning: 'bg-yellow-500',
  failed: 'bg-red-500',
  skipped: 'bg-gray-600',
};

function asExportReport(report: InvestigationReport): InvestigationReportExport {
  return report as unknown as InvestigationReportExport;
}

function Section({
  title, icon: Icon, defaultOpen = true, children,
}: {
  title: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-bg-elevated/50 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-dna-500/15 flex items-center justify-center shrink-0">
          <Icon size={16} className="text-dna-400" />
        </div>
        <span className="flex-1 text-sm font-semibold text-white">{title}</span>
        {open ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
      </button>
      {open && <div className="px-4 pb-4 border-t border-bg-border pt-4">{children}</div>}
    </div>
  );
}

export function UnifiedInvestigationPage() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'upload' | 'scan'>('upload');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [report, setReport] = useState<InvestigationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const runInvestigation = useCallback(async (f: File) => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const { report: r } = await unifiedInvestigate(f);
      setReport(r as unknown as InvestigationReport);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Investigation failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFileSelect = (f: File) => {
    setReport(null);
    setError(null);
    setFile(f);
    runInvestigation(f);
  };

  const handleScanComplete = (f: File) => {
    setReport(null);
    setError(null);
    setFile(f);
    runInvestigation(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  };

  const handleReset = () => {
    setFile(null);
    setReport(null);
    setError(null);
  };

  const completedSteps = report?.pipeline.filter((s) => s.status === 'complete').length ?? 0;
  const totalSteps = report?.pipeline.length ?? 14;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-dna-500/20 flex items-center justify-center">
          <Microscope size={20} className="text-dna-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Unified Forensic Investigation Center</h1>
          <p className="text-xs text-gray-500">
            Upload or scan a suspected file to perform a complete forensic investigation.
          </p>
        </div>
      </div>

      {!report && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setMode('upload'); }}
            className={cn(
              'flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2',
              mode === 'upload'
                ? 'bg-dna-500/15 text-dna-400 border border-dna-500/30'
                : 'bg-bg-elevated text-gray-400 border border-bg-border',
            )}
          >
            <Upload size={14} /> Upload File
          </button>
          <button
            type="button"
            onClick={() => { setMode('scan'); setFile(null); }}
            className={cn(
              'flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2',
              mode === 'scan'
                ? 'bg-dna-500/15 text-dna-400 border border-dna-500/30'
                : 'bg-bg-elevated text-gray-400 border border-bg-border',
            )}
          >
            <ScanLine size={14} /> Scan Document
          </button>
        </div>
      )}

      {!report && mode === 'upload' && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => !loading && inputRef.current?.click()}
          className={cn(
            'card border-2 border-dashed text-center py-12 transition-colors',
            loading ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:border-dna-500/50 border-bg-border',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }}
          />
          {loading ? (
            <div>
              <RefreshCw size={32} className="text-dna-400 mx-auto mb-3 animate-spin" />
              <p className="text-sm font-semibold text-white">Running 14-step investigation pipeline…</p>
              <p className="text-2xs text-gray-500 mt-1">{file?.name}</p>
            </div>
          ) : file ? (
            <div>
              <CheckCircle size={32} className="text-green-400 mx-auto mb-3" />
              <p className="text-sm font-semibold text-white">{file.name}</p>
              <p className="text-2xs text-gray-500 mt-1">Investigation starting…</p>
            </div>
          ) : (
            <div>
              <Upload size={32} className="text-gray-500 mx-auto mb-3" />
              <p className="text-sm text-gray-400">Drop a suspected file here or click to upload</p>
              <p className="text-2xs text-gray-600 mt-1">Single file · max 500MB · investigation runs automatically</p>
            </div>
          )}
        </div>
      )}

      {!report && mode === 'scan' && (
        <div className="space-y-3">
          {loading ? (
            <div className="card text-center py-12">
              <RefreshCw size={32} className="text-dna-400 mx-auto mb-3 animate-spin" />
              <p className="text-sm font-semibold text-white">Running 14-step investigation pipeline…</p>
              <p className="text-2xs text-gray-500 mt-1">{file?.name}</p>
            </div>
          ) : (
            <DocumentScanner
              onScanComplete={handleScanComplete}
              onCancel={handleReset}
              subtitle="Capture one or more pages, then generate a PDF or single image for full forensic investigation"
            />
          )}
        </div>
      )}

      {error && (
        <div className="card border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-400">Investigation failed</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
            <button type="button" onClick={handleReset} className="btn btn-secondary mt-3 text-xs">Try again</button>
          </div>
        </div>
      )}

      {report && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={cn('text-xs font-bold px-3 py-1 rounded-full border', RISK_COLORS[report.summary.riskLevel] ?? RISK_COLORS.UNKNOWN)}>
                Risk: {report.summary.riskLevel}
              </span>
              <span className="text-2xs text-gray-500 mono">{report.investigationId.slice(0, 8)}…</span>
            </div>
            <button type="button" onClick={handleReset} className="btn btn-secondary text-xs">
              <RefreshCw size={12} /> New Investigation
            </button>
          </div>

          {/* Pipeline progress */}
          <div className="card p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Investigation Pipeline — {completedSteps}/{totalSteps} complete
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {report.pipeline.map((s) => (
                <div key={s.id} className="flex flex-col items-center text-center gap-1 p-2 rounded-lg bg-bg-elevated">
                  <span className={cn('w-2 h-2 rounded-full', STEP_STATUS[s.status])} title={s.detail} />
                  <span className="text-2xs text-gray-400 leading-tight">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {report.message && (
            <div className="card border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-400">
              {report.message}
            </div>
          )}

          <Section title="1. Investigation Summary" icon={Shield}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: 'Ownership Confidence', value: `${report.summary.ownershipConfidence}%` },
                { label: 'DNA Match', value: `${report.summary.dnaMatchPercent}%` },
                { label: 'Certificate', value: report.summary.certificateStatus },
                { label: 'Identity', value: report.summary.identityStatus },
                { label: 'Tamper Severity', value: report.summary.tamperSeverity },
                { label: 'Risk Level', value: report.summary.riskLevel },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-bg-elevated p-3">
                  <p className="text-2xs text-gray-500">{label}</p>
                  <p className="text-sm font-bold text-white mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="2. Original Owner" icon={User}>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {Object.entries({
                'Owner Name': report.owner.ownerName,
                'PINIT ID': report.owner.ownerPinitId,
                'Vault ID': report.owner.vaultId,
                'DNA Record ID': report.owner.dnaRecordId,
                'Certificate ID': report.owner.certificateId,
                'Original Filename': report.owner.originalFilename,
                'Created': report.owner.createdAt,
              }).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 py-1 border-b border-bg-border/50">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-white mono text-right truncate max-w-[60%]">{v ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="3. Recipient Attribution" icon={Eye}>
            {report.recipientAttribution.fromShare ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {Object.entries({
                  'Recipient': report.recipientAttribution.recipientName as string,
                  'PINIT ID': report.recipientAttribution.recipientPinitId as string,
                  'Share ID': report.recipientAttribution.shareId as string,
                  'View Time': report.recipientAttribution.viewTime as string,
                  'Download Time': report.recipientAttribution.downloadTime as string,
                  'Screenshot': report.recipientAttribution.screenshotDetected ? 'Detected' : 'No',
                  'Screen Recording': report.recipientAttribution.screenRecordingDetected ? 'Detected' : 'No',
                  'Last Device': report.recipientAttribution.lastDevice as string,
                }).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 py-1">
                    <dt className="text-gray-500">{k}</dt>
                    <dd className="text-white">{v ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-blue-400">Original Owner Only — no share recipient attribution.</p>
            )}
          </Section>

          <Section title="4. 15-Layer DNA Analysis" icon={Dna} defaultOpen={false}>
            {report.layerAnalysis.length === 0 ? (
              <p className="text-xs text-gray-500">No layer comparison — vault match required.</p>
            ) : (
              <div className="space-y-2">
                {report.layerAnalysis.map((l) => (
                  <div key={l.layer} className="flex items-center gap-3 p-2 rounded-lg bg-bg-elevated">
                    <span className="text-2xs text-gray-500 w-6 mono">L{l.layer}</span>
                    <span className="flex-1 text-xs text-white truncate">{l.name}</span>
                    <span className="text-xs font-bold text-white mono">{l.matchPercent}%</span>
                    <span className={cn('text-2xs px-2 py-0.5 rounded-full uppercase', LAYER_STATUS[l.status] ?? LAYER_STATUS.skipped)}>
                      {l.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="5. Tamper Analysis" icon={AlertTriangle} defaultOpen={false}>
            <p className="text-sm font-bold text-white mb-2">
              Overall Tamper Score: {report.tamperAnalysis.overallTamperScore}%
              <span className="text-gray-500 font-normal ml-2">({report.tamperAnalysis.primaryVector})</span>
            </p>
            {report.tamperAnalysis.description && (
              <p className="text-xs text-gray-400 mb-3">{report.tamperAnalysis.description}</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {report.tamperAnalysis.vectors.map((v) => (
                <div key={v.label} className={cn('text-xs px-2 py-1.5 rounded-lg border', v.detected ? 'border-orange-500/40 text-orange-400 bg-orange-500/10' : 'border-bg-border text-gray-500')}>
                  {v.label}{v.detected ? ' ✓' : ''}
                </div>
              ))}
            </div>
          </Section>

          <Section title="6. Timeline" icon={Clock} defaultOpen={false}>
            <div className="space-y-0">
              {report.timeline.map((ev, i) => (
                <div key={i} className="flex gap-3 py-2 border-l-2 border-dna-500/30 pl-4 ml-2">
                  <div>
                    <p className="text-xs font-semibold text-white">{ev.stage}</p>
                    {ev.timestamp && <p className="text-2xs text-gray-500 mono">{ev.timestamp}</p>}
                    {ev.detail && <p className="text-2xs text-gray-400">{ev.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="7. Access Intelligence" icon={Activity} defaultOpen={false}>
            {report.accessIntelligence.length === 0 ? (
              <p className="text-xs text-gray-500">No access events recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-2xs">
                  <thead>
                    <tr className="text-gray-500 text-left">
                      <th className="pb-2 pr-2">Time</th>
                      <th className="pb-2 pr-2">Action</th>
                      <th className="pb-2 pr-2">IP</th>
                      <th className="pb-2 pr-2">Device</th>
                      <th className="pb-2">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.accessIntelligence.map((a, i) => (
                      <tr key={i} className="border-t border-bg-border text-gray-300">
                        <td className="py-1.5 pr-2 mono">{a.timestamp}</td>
                        <td className="py-1.5 pr-2">{a.action}</td>
                        <td className="py-1.5 pr-2 mono">{a.ipAddress}</td>
                        <td className="py-1.5 pr-2">{a.device ?? a.browser}</td>
                        <td className="py-1.5">{[a.city, a.country].filter(Boolean).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="8. Leak Intelligence" icon={Globe} defaultOpen={false}>
            {report.leakIntelligence.hasPublicLeak ? (
              <div className="space-y-2">
                {report.leakIntelligence.entries.map((e, i) => (
                  <div key={i} className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs">
                    <p className="text-red-400 font-semibold">{e.platform} — {e.status}</p>
                    <a href={e.url} className="text-blue-400 break-all" target="_blank" rel="noreferrer">{e.url}</a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-green-400">No public leak detected.</p>
            )}
          </Section>

          <Section title="9. Identity Proof" icon={Fingerprint} defaultOpen={false}>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs mb-4">
              {[
                ['Vault ID', report.identityProof.vaultId],
                ['DNA Record ID', report.identityProof.dnaRecordId],
                ['Certificate ID', report.identityProof.certificateId],
                ['Owner PINIT ID', report.identityProof.ownerPinitId],
                ['Digital Signature', report.identityProof.digitalSignatureValid ? 'VALID' : 'INVALID'],
                ['Identity Verification', report.identityProof.identityVerification],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between gap-2 py-1 border-b border-bg-border/50">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-white mono text-right truncate max-w-[60%]">{v ?? '—'}</dd>
                </div>
              ))}
            </dl>
            <div className={cn('rounded-xl border p-4', WATERMARK_STATUS_STYLE[report.identityProof.watermark?.status ?? 'NOT_EMBEDDED'])}>
              <p className="text-xs font-bold uppercase tracking-wide mb-2">Watermark Status</p>
              <p className="text-sm font-bold">
                {watermarkDisplayLabel(report.identityProof.watermark?.status ?? 'NOT_EMBEDDED')}
              </p>
              {report.identityProof.watermark?.status === 'DETECTED' ? (
                <dl className="mt-3 space-y-1.5 text-xs">
                  {report.identityProof.watermark.vaultId && (
                    <div className="flex justify-between"><dt className="opacity-80">Vault ID</dt><dd className="mono">{report.identityProof.watermark.vaultId}</dd></div>
                  )}
                  {report.identityProof.watermark.ownerPinitId && (
                    <div className="flex justify-between"><dt className="opacity-80">Owner</dt><dd>{report.identityProof.watermark.ownerPinitId}</dd></div>
                  )}
                  {report.identityProof.watermark.confidence != null && (
                    <div className="flex justify-between"><dt className="opacity-80">Confidence</dt><dd>{report.identityProof.watermark.confidence}%</dd></div>
                  )}
                  {report.identityProof.watermark.code && (
                    <div className="flex justify-between"><dt className="opacity-80">Code</dt><dd className="mono">{report.identityProof.watermark.code}</dd></div>
                  )}
                </dl>
              ) : (
                <p className="text-xs mt-2 opacity-90">
                  <span className="font-semibold">Reason: </span>
                  {report.identityProof.watermark?.reason ?? 'No watermark data available.'}
                </p>
              )}
            </div>
          </Section>

          <Section title="10. Evidence Package" icon={FileDown}>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary text-xs"
                onClick={() => { void downloadInvestigationReportPdf(asExportReport(report)); }}
              >
                <Download size={12} /> Investigation Report (PDF)
              </button>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                onClick={() => { void downloadDnaReportPdf(asExportReport(report)); }}
              >
                <Dna size={12} /> DNA Report (PDF)
              </button>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                onClick={() => { void downloadTimelineReportPdf(asExportReport(report)); }}
              >
                <Clock size={12} /> Timeline Report (PDF)
              </button>
              <button
                type="button"
                className="btn btn-primary text-xs"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  try {
                    await downloadEvidencePackageZip(asExportReport(report));
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                {exporting ? <RefreshCw size={12} className="animate-spin" /> : <Lock size={12} />}
                {exporting ? ' Building ZIP…' : ' Evidence Package (ZIP)'}
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs border border-bg-border"
                onClick={() => downloadAdvancedExportJson(asExportReport(report))}
              >
                <FileDown size={12} /> Advanced Export (JSON)
              </button>
            </div>
            <p className="text-2xs text-gray-600 mt-3">
              Evidence ZIP includes PDF reports, JSON artifacts, pipeline logs, and screenshot folder placeholder.
              Legal Evidence Bundle — coming soon.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
