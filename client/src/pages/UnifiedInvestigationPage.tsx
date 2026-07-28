import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Shield, Upload, AlertTriangle, RefreshCw, ScanLine,
  ChevronDown, ChevronUp, Fingerprint, Dna, User, Clock, Activity,
  FileDown, Globe, Lock, Eye, Download, Microscope,
} from 'lucide-react';
import { unifiedInvestigateStream } from '../services/dashboard.api';
import { cn } from '../components/ui/utils';
import { InvestigationScanner } from '../components/InvestigationScanner';
import { InvestigationProcessingCard } from '../components/InvestigationProcessingCard';
import { InvestigationLivePanel } from '../components/InvestigationLivePanel';
import { InvestigationSideBySideCompare } from '../components/InvestigationSideBySideCompare';
import type { InvestigationLiveSnapshot } from '../services/dashboard.api';
import {
  downloadInvestigationReportPdf,
  downloadDnaReportPdf,
  downloadTimelineReportPdf,
  downloadEvidencePackageZip,
  downloadAdvancedExportJson,
  archiveInvestigationForensicExports,
  type InvestigationReportExport,
  type InvestigationReportPdfOptions,
} from '../services/investigation-report-export';
import { saveInvestigationReport, mergeLiveSnapshotIntoReport, type StoredInvestigationReport } from '../lib/forensic-reports-storage';
import {
  investigationSummaryScore,
  resolveInvestigationOwner,
  formatEvidenceValue,
} from '../lib/forensic-report-display';

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
    trustScore?: number;
    identityConfidence?: number;
    retrievalConfidence?: number;
    ownershipVerificationConfidence?: number;
    forensicVerdict?: 'ORIGINAL_VERIFIED' | 'ORIGINAL_FOUND_PARTIAL' | 'POSSIBLE_ASSET' | 'NO_SIGNATURE';
    reportState?: 'VERIFIED' | 'POSSIBLE' | 'NO_SIGNATURE';
    decisionReason?: string;
    forensicReasons?: string[];
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
    vectors: Array<{ label: string; detected: boolean; confidence?: number; evidence?: string[] }>;
    description?: string;
    changesVsOriginal?: Array<{
      type: string;
      detected: boolean;
      confidence: number;
      detail: string;
      where?: string;
    }>;
    overlayPngBase64?: string;
    modifiedPercent?: number;
    insertedRegions?: number;
    cropDetection?: {
      sharedRegionPercent?: number;
      visiblePercent?: number;
      cropPercent?: number;
      missingPercent?: number;
      homographyFound?: boolean;
    };
  };
  forensicEvidence?: {
    recoveredWatermark?: boolean;
    recoveredOwner?: string | null;
    vaultId?: string;
    certificateId?: string | null;
    screenshotDetected?: boolean;
    screenshotPlatform?: string;
    screenshotConfidence?: number;
    aiEdited?: boolean;
    aiEditConfidence?: number;
    aiEditReason?: string;
    matchReasons?: Array<{ signal: string; label: string; percent: number; matched: boolean }>;
    overallConfidence?: number;
  };
  timeline: Array<{ stage: string; timestamp?: string; detail?: string }>;
  evidenceTimeline?: Array<{
    id: string;
    eventType: string;
    summary: string;
    timestamp: string;
    locationLabel?: string;
    actorLabel?: string;
    device?: string;
    tepCode?: string;
    certificateId?: string;
    source?: 'provenance' | 'legacy';
  }>;
  provenanceSummary?: {
    creationLocation?: string;
    creationTime?: string;
    lastDownload?: string;
    lastProtectedExport?: string;
    lastKnownDevice?: string;
    lastKnownLocation?: string;
    firstInvestigation?: string;
    latestInvestigation?: string;
    tamperCount: number;
    downloadCount: number;
    shareCount: number;
    investigationCount: number;
    countriesSeen: string[];
    devicesSeen: string[];
  };
  accessIntelligence: Array<Record<string, string | undefined>>;
  leakIntelligence: {
    hasPublicLeak: boolean;
    entries: Array<{ platform: string; url: string; firstSeen?: string; lastSeen?: string; status: string }>;
    message: string;
    leakChain?: Array<{ platform: string; date?: string; status: string }>;
    currentStatus?: string;
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
  matchTier?: number;
  matchMethod?: string;
  /** Phase 2 — immutable Investigation Manifest (single source of truth) */
  manifest?: {
    verdict: string;
    displayLabel: string;
    decisionReason: string;
    confidence: number;
    acceptancePolicyVersion: string;
    dnaAlgorithmVersion: string;
    owner: { ownerName?: string | null; ownerPinitId?: string | null };
    vault: { vaultId?: string; originalFilename?: string };
    dna: { dnaRecordId?: string; matchPercent?: number };
    certificate: { certificateId?: string | null; status?: string };
  };
  identityRecovery?: {
    enginesRun: number;
    enginesRecovered: number;
    message: string;
    compositeScores: { ownershipConfidence: number; trustScore: number; identityConfidence: number };
    signals: Array<{ label: string; score: number; weight: number; weightedContribution: number; status: string; detail?: string }>;
    transformations: Array<{ type: string; detected: boolean; detail?: string }>;
  };
  candidateRanking?: Array<{
    rank: number;
    vaultId: string;
    dnaRecordId: string;
    compositeScore: number;
    method: string;
    signals: string[];
    selected?: boolean;
    dnaMatchPercent?: number;
  }>;
  identityRecoveryReport?: {
    recovered: boolean;
    message: string;
    originalOwner?: string | null;
    ownerPinitId?: string | null;
    vaultId?: string;
    dnaRecordId?: string;
    certificateId?: string | null;
    originalFilename?: string;
    originalHash?: string;
    currentHash?: string;
    evidenceConfidence?: number;
    protectedDownloadDate?: string;
    tepCode?: string | null;
    registrationTimestamp?: string;
  };
  currentFileHash?: string;
}

const REPORT_STATE_LABELS: Record<string, string> = {
  VERIFIED: 'Ownership Verified',
  POSSIBLE: 'Possible Similarity – Top Candidates Only',
  NO_SIGNATURE: 'Unknown Asset',
};

const REPORT_STATE_STYLE: Record<string, string> = {
  VERIFIED: 'text-green-400 bg-green-500/10 border-green-500/30',
  POSSIBLE: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  NO_SIGNATURE: 'text-red-400 bg-red-500/10 border-red-500/30',
};

const FORENSIC_VERDICT_LABELS: Record<string, string> = {
  ORIGINAL_VERIFIED: 'Ownership Verified',
  ORIGINAL_FOUND_PARTIAL: 'Original Identified (Derivative / Partial)',
  POSSIBLE_ASSET: 'Possible Similarity – Top Candidates Only',
  NO_SIGNATURE: 'Unknown Asset',
};

const FORENSIC_VERDICT_STYLE: Record<string, string> = {
  ORIGINAL_VERIFIED: 'text-green-400 bg-green-500/10 border-green-500/30',
  ORIGINAL_FOUND_PARTIAL: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  POSSIBLE_ASSET: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  NO_SIGNATURE: 'text-red-400 bg-red-500/10 border-red-500/30',
};

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

const TAMPER_VECTOR_LABELS: Record<string, string> = {
  NONE: 'No significant tampering',
  MINIMAL_DERIVATIVE: 'Minimal derivative (high visual match)',
  EXACT_COPY: 'Exact copy',
  CROP: 'Crop / partial clip',
  COMPRESSION: 'Compression / re-encode',
  PARTIAL_CLIP: 'Partial clip',
  RE_ENCODE: 'Re-encode / format shift',
  COPY_PASTE: 'Modified from protected original',
  TEXT_LETTER_MISMATCH: 'Text / letter changes',
  UNKNOWN: 'Inconclusive — live recovery only',
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

export function UnifiedInvestigationPage({ adminMode = false }: { adminMode?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'upload' | 'scan'>('upload');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<'investigation' | 'dna' | 'timeline' | null>(null);
  const [report, setReport] = useState<InvestigationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captureProcessing, setCaptureProcessing] = useState(false);
  const [liveSnapshot, setLiveSnapshot] = useState<InvestigationLiveSnapshot | null>(null);
  const liveSnapshotRef = useRef<InvestigationLiveSnapshot | null>(null);
  const [scannerKey, setScannerKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (report) {
      reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [report]);

  const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

  const INVESTIGATION_EXTS = [
    'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif',
    'pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls',
    'txt', 'csv', 'json',
    'mp4', 'mov', 'webm', 'avi', 'mkv',
    'mp3', 'wav', 'm4a', 'aac',
    'zip',
  ];

  const validateInvestigationFile = (f: File): string | null => {
    if (!f.size) return 'Selected file is empty.';
    if (f.size > MAX_UPLOAD_BYTES) return 'File is too large (max 100 MB).';
    const okPrefix = f.type.startsWith('image/')
      || f.type.startsWith('video/')
      || f.type.startsWith('audio/')
      || f.type === 'application/pdf'
      || f.type === 'text/plain'
      || f.type === 'text/csv'
      || f.type === 'application/json'
      || f.type === 'application/zip'
      || f.type.includes('word')
      || f.type.includes('presentation')
      || f.type.includes('sheet')
      || f.type.includes('opendocument')
      || f.type.startsWith('application/');
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    const okExt = INVESTIGATION_EXTS.includes(ext);
    if (!okPrefix && !okExt) {
      return 'Unsupported file type. Upload image, PDF, DOCX, PPTX, XLSX, TXT, CSV, video, audio, or ZIP.';
    }
    return null;
  };

  const runInvestigation = useCallback(async (f: File) => {
    const validationError = validateInvestigationFile(f);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError(null);
    setReport(null);
    setLiveSnapshot(null);
    liveSnapshotRef.current = null;

    try {
      const { report: r } = await unifiedInvestigateStream(f, (event) => {
        if (event.snapshot?.vaultId) {
          setLiveSnapshot(event.snapshot);
          liveSnapshotRef.current = event.snapshot;
        } else if (event.partial?.vaultId) {
          const prev = liveSnapshotRef.current;
          const partial = event.partial as {
            vaultId?: string;
            dnaRecordId?: string;
            ownerPinitId?: string;
            ownerName?: string;
            originalFilename?: string;
            ownershipConfidence?: number;
            dnaMatchPercent?: number;
          };
          const merged = {
            phase: prev?.phase ?? 1,
            signatureFound: true,
            vaultId: partial.vaultId,
            dnaRecordId: partial.dnaRecordId ?? prev?.dnaRecordId,
            ownerPinitId: partial.ownerPinitId ?? prev?.ownerPinitId,
            ownerName: partial.ownerName ?? prev?.ownerName,
            originalFilename: partial.originalFilename ?? prev?.originalFilename,
            confidence: partial.ownershipConfidence ?? prev?.confidence,
            dnaMatchPercent: partial.dnaMatchPercent ?? prev?.dnaMatchPercent,
          };
          setLiveSnapshot(merged);
          liveSnapshotRef.current = merged;
        }
      }, { admin: adminMode });
      const investigation = r as unknown as InvestigationReport;
      setReport(investigation);
      const toStore = mergeLiveSnapshotIntoReport(
        investigation as unknown as StoredInvestigationReport,
        liveSnapshotRef.current,
      );
      saveInvestigationReport(toStore, f.name);
      // Auto-archive all PDFs into Forensic Reports (no download required).
      const archiveOwner = resolveInvestigationOwner(toStore);
      void archiveInvestigationForensicExports(
        asExportReport(toStore as unknown as InvestigationReport),
        { probeFile: f, vaultId: archiveOwner.vaultId },
      ).catch(() => { /* archive is best-effort; investigation result is already saved */ });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Investigation failed';
      setError(msg);
    } finally {
      setLoading(false);
      setLiveSnapshot(null);
      liveSnapshotRef.current = null;
    }
  }, [adminMode]);

  /** Upload path: File Picker → same investigation as scanner. */
  const handleFileSelect = (f: File) => {
    setReport(null);
    setError(null);
    setFile(f);
    setCaptureProcessing(false);
    runInvestigation(f);
  };

  /** Scanner path: Camera → File → identical investigation (no separate API). */
  const handleScanComplete = (f: File) => {
    setReport(null);
    setError(null);
    setFile(f);
    setCaptureProcessing(false);
    runInvestigation(f);
  };

  const handleScanProcessingStart = () => {
    setCaptureProcessing(true);
    setError(null);
  };

  const handleScanCaptureError = (message: string) => {
    setCaptureProcessing(false);
    setError(message);
    setScannerKey((k) => k + 1);
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
    setCaptureProcessing(false);
    setScannerKey((k) => k + 1);
  };

  const investigating = loading || captureProcessing;

  const completedSteps = report?.pipeline.filter((s) => s.status === 'complete').length ?? 0;
  const totalSteps = report?.pipeline.length ?? 16;

  return (
    <div className="page-shell w-full max-w-5xl space-y-6 min-w-0">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-dna-500/20 flex items-center justify-center">
          <Microscope size={20} className="text-dna-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Unified Forensic Investigation Center</h1>
          <p className="text-xs text-gray-500">
            Upload or scan a suspected file — both modes run the full PINIT identity recovery pipeline.
          </p>
        </div>
      </div>

      {!report && investigating && (
        liveSnapshot ? (
          <InvestigationLivePanel snapshot={liveSnapshot} file={file} fileName={file?.name} />
        ) : (
          <InvestigationProcessingCard file={file} />
        )
      )}

      {!report && !investigating && (
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
            onClick={() => { setMode('scan'); setFile(null); setError(null); setScannerKey((k) => k + 1); }}
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

      {!report && !investigating && mode === 'upload' && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="card border-2 border-dashed text-center py-12 cursor-pointer hover:border-dna-500/50 border-bg-border transition-colors"
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf,.pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.csv,.json,video/*,audio/*,.zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) handleFileSelect(picked);
              e.target.value = '';
            }}
          />
          <Upload size={32} className="text-gray-500 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Drop a suspected file here or click to upload</p>
          <p className="text-2xs text-gray-600 mt-1">
            Image · PDF · DOCX · PPTX · XLSX · TXT/CSV · Video · Audio · ZIP — runs automatically
          </p>
        </div>
      )}

      {!report && !investigating && mode === 'scan' && (
        <InvestigationScanner
          key={scannerKey}
          onScanComplete={handleScanComplete}
          onProcessingStart={handleScanProcessingStart}
          onCaptureError={handleScanCaptureError}
          onCancel={() => { setMode('upload'); handleReset(); }}
        />
      )}

      {error && !investigating && (
        <div className="card border border-red-500/30 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-400">Investigation failed</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
            <button type="button" onClick={handleReset} className="btn btn-secondary mt-3 text-xs">Try again</button>
          </div>
        </div>
      )}

      {report && (() => {
        // Prefer immutable manifest when present (Phase 2 single source of truth).
        const manifest = report.manifest;
        const reportState = report.summary.reportState;
        const resolvedOwner = resolveInvestigationOwner(report as unknown as StoredInvestigationReport);
        const hasVaultMatch = reportState !== 'NO_SIGNATURE' && !!(
          resolvedOwner.vaultId
          || manifest?.vault.vaultId
          || report.owner.vaultId
          || report.identityProof.vaultId
        );
        const displayMatchScore = investigationSummaryScore(
          report.summary as StoredInvestigationReport['summary'],
        );
        const dnaLayerScore = report.summary.dnaMatchPercent;
        const pdfExportOptions: InvestigationReportPdfOptions = {
          probeFile: file,
          vaultId: resolvedOwner.vaultId,
        };
        const verdictLabel = reportState === 'VERIFIED'
          ? REPORT_STATE_LABELS.VERIFIED
          : reportState === 'POSSIBLE'
            ? REPORT_STATE_LABELS.POSSIBLE
            : (manifest?.displayLabel
              ?? (report.summary.reportState
                ? REPORT_STATE_LABELS[report.summary.reportState]
                : FORENSIC_VERDICT_LABELS[report.summary.forensicVerdict!] ?? report.summary.forensicVerdict));
        return (
        <div ref={reportRef} className="space-y-6 scroll-mt-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {(manifest?.verdict || report.summary.reportState || report.summary.forensicVerdict) && (
                <span className={cn(
                  'text-xs font-bold px-3 py-1 rounded-full border',
                  REPORT_STATE_STYLE[report.summary.reportState ?? ''] 
                    ?? FORENSIC_VERDICT_STYLE[report.summary.forensicVerdict ?? ''] 
                    ?? RISK_COLORS.UNKNOWN,
                )}>
                  {verdictLabel}
                </span>
              )}
              <span className={cn('text-xs font-bold px-3 py-1 rounded-full border', RISK_COLORS[report.summary.riskLevel] ?? RISK_COLORS.UNKNOWN)}>
                Risk: {report.summary.riskLevel}
              </span>
              {resolvedOwner.vaultId && (
                <span className="text-xs font-semibold px-3 py-1 rounded-full border border-sky-500/40 bg-sky-500/10 text-sky-300 mono" title={resolvedOwner.vaultId}>
                  Vault {resolvedOwner.vaultId.slice(0, 8)}…
                </span>
              )}
              {resolvedOwner.originalFilename && (
                <span className="text-2xs text-gray-400 truncate max-w-[220px]" title={resolvedOwner.originalFilename}>
                  Original: {resolvedOwner.originalFilename}
                </span>
              )}
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
              {report.pipeline.map((s) => (
                <div key={s.id} className="flex flex-col items-center text-center gap-1 p-2 rounded-lg bg-bg-elevated">
                  <span className={cn('w-2 h-2 rounded-full', STEP_STATUS[s.status])} title={s.detail} />
                  <span className="text-2xs text-gray-400 leading-tight">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {(manifest?.decisionReason || report.message) && (
            <div className={cn(
              'card border p-3 text-xs',
              reportState === 'NO_SIGNATURE'
                ? 'border-red-500/30 bg-red-500/5 text-red-400'
                : reportState === 'POSSIBLE'
                  ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400'
                  : 'border-green-500/30 bg-green-500/5 text-green-400',
            )}>
              {manifest?.displayLabel ?? report.message}
              {(manifest?.decisionReason ?? report.summary.decisionReason)
                && (manifest?.decisionReason ?? report.summary.decisionReason) !== (manifest?.displayLabel ?? report.message) && (
                <p className="mt-1 opacity-80">{manifest?.decisionReason ?? report.summary.decisionReason}</p>
              )}
            </div>
          )}

          {hasVaultMatch && (
            <InvestigationSideBySideCompare
              vaultId={resolvedOwner.vaultId}
              probePreviewUrl={previewUrl}
              probeFileName={file?.name ?? report.dnaComparison?.fileB?.filename}
              probeMimeType={file?.type ?? report.dnaComparison?.fileB?.mimeType}
              originalFilename={
                resolvedOwner.originalFilename
                ?? report.dnaComparison?.fileA?.filename
              }
              ownerPinitId={resolvedOwner.ownerPinitId}
              dnaMatchPercent={dnaLayerScore}
              matchConfidence={displayMatchScore}
              reportState={report.summary.reportState}
              dnaRecordId={resolvedOwner.dnaRecordId}
              certificateId={resolvedOwner.certificateId}
            />
          )}

          <Section title="1. Investigation Summary" icon={Shield}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: 'Retrieval Confidence', value: `${report.summary.retrievalConfidence ?? report.summary.dnaMatchPercent}%` },
                { label: 'Identity Recovery', value: `${report.summary.identityConfidence ?? report.identityRecovery?.compositeScores.identityConfidence ?? '—'}${typeof report.summary.identityConfidence === 'number' ? '%' : ''}` },
                { label: 'Ownership Verification', value: `${report.summary.ownershipVerificationConfidence ?? report.summary.ownershipConfidence}%` },
                { label: 'DNA Match', value: report.summary.reportState === 'VERIFIED'
                  ? `${report.summary.dnaMatchPercent}%`
                  : report.summary.reportState === 'POSSIBLE'
                    ? (typeof dnaLayerScore === 'number' && dnaLayerScore >= 40
                        ? `${dnaLayerScore}% (review)`
                        : `${displayMatchScore}% match · DNA layer ${dnaLayerScore ?? 0}%`)
                    : '—' },
                { label: 'Trust Score', value: `${report.summary.trustScore ?? report.identityRecovery?.compositeScores.trustScore ?? '—'}${typeof report.summary.trustScore === 'number' ? '%' : ''}` },
                { label: 'Certificate', value: report.summary.certificateStatus },
                { label: 'Identity', value: report.summary.identityStatus.replace(/_/g, ' ') },
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

          {report.identityRecovery && (
            <Section title="1b. Multi-Layer Identity Recovery" icon={Fingerprint} defaultOpen={false}>
              <p className="text-xs text-gray-400 mb-3">{report.identityRecovery.message}</p>
              <div className="space-y-2">
                {report.identityRecovery.signals.filter((s) => s.weight > 0).map((s) => (
                  <div key={s.label} className="flex items-center gap-3 p-2 rounded-lg bg-bg-elevated text-xs">
                    <span className="flex-1 text-white">{s.label}</span>
                    <span className="mono text-gray-400">{Math.round(s.weight * 100)}% wt</span>
                    <span className="font-bold text-white mono w-10 text-right">{s.score}%</span>
                    <span className={cn(
                      'text-2xs px-2 py-0.5 rounded-full uppercase',
                      s.status === 'recovered' ? 'bg-green-500/15 text-green-400'
                        : s.status === 'partial' ? 'bg-yellow-500/15 text-yellow-400'
                          : 'bg-gray-500/15 text-gray-500',
                    )}>{s.status}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {hasVaultMatch && (
            <Section title="1c. Identity Recovery Report" icon={Lock}>
              <p className={cn(
                'text-xs mb-3',
                resolvedOwner.ownershipVerified ? 'text-green-400' : 'text-yellow-400',
              )}>
                {resolvedOwner.ownershipVerified
                  ? (report.identityRecoveryReport?.message
                    ?? 'Original identity recovered from multi-layer forensic signals')
                  : (report.identityRecoveryReport?.message
                    ?? report.summary.decisionReason
                    ?? 'Candidate vault found — ownership not verified. Manual review recommended.')}
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {Object.entries({
                  'Original Owner': resolvedOwner.ownerName,
                  'Owner PINIT ID': resolvedOwner.ownerPinitId,
                  'Vault ID': resolvedOwner.vaultId,
                  'DNA ID': resolvedOwner.dnaRecordId,
                  'Certificate ID': resolvedOwner.certificateId,
                  'Original Filename': resolvedOwner.originalFilename,
                  'Original Hash': report.identityRecoveryReport?.originalHash,
                  'Current Hash': report.identityRecoveryReport?.currentHash ?? report.currentFileHash,
                  'Evidence Confidence': report.identityRecoveryReport?.evidenceConfidence != null
                    ? `${report.identityRecoveryReport.evidenceConfidence}%`
                    : `${displayMatchScore}%`,
                  'TEP Code': report.identityRecoveryReport?.tepCode ?? 'Not embedded on this file',
                  'Protected Download': report.identityRecoveryReport?.protectedDownloadDate
                    ? new Date(report.identityRecoveryReport.protectedDownloadDate).toLocaleString()
                    : report.identityRecoveryReport?.tepCode
                      ? 'Tracked export — see Evidence Timeline'
                      : 'No protected download recorded',
                  'Registered': report.identityRecoveryReport?.registrationTimestamp
                    ?? (resolvedOwner.ownershipVerified ? report.owner.createdAt : null),
                }).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 py-1 border-b border-bg-border/50">
                    <dt className="text-gray-500">{k}</dt>
                    <dd className="text-white mono text-right truncate min-w-0 max-w-full sm:max-w-[60%]">
                      {formatEvidenceValue(v as string | number | null | undefined)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          {hasVaultMatch && report.candidateRanking && report.candidateRanking.length > 0 && (
            <Section title="1d. Vault Candidate Ranking" icon={Dna} defaultOpen={false}>
              <p className="text-xs text-gray-500 mb-3">Top {report.candidateRanking.length} vault candidates scored — best match selected for deep comparison</p>
              <div className="space-y-1">
                {report.candidateRanking.slice(0, 10).map((c) => (
                  <div key={c.vaultId} className={cn(
                    'flex items-center gap-2 p-2 rounded-lg text-xs',
                    c.selected ? 'bg-dna-500/10 border border-dna-500/30' : 'bg-bg-elevated',
                  )}>
                    <span className="mono text-gray-500 w-6">#{c.rank}</span>
                    <span className="flex-1 truncate text-white">{c.method}</span>
                    <span className="font-bold mono">{c.compositeScore}%</span>
                    {c.selected && <span className="text-2xs text-dna-400">SELECTED</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {hasVaultMatch ? (
          <Section title={resolvedOwner.ownershipVerified ? '2. Original Owner' : '2. Top Candidate Vault'} icon={User}>
            {report.matchMethod && (
              <p className="text-xs text-dna-400 mb-3">
                Vault match: {report.matchMethod}
                {report.matchTier != null ? ` (tier ${report.matchTier})` : ''}
                {!resolvedOwner.ownershipVerified
                  ? ' — candidate details below; ownership claim pending verification'
                  : ''}
              </p>
            )}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {Object.entries({
                'Owner Name': resolvedOwner.ownerName,
                'PINIT ID': resolvedOwner.ownerPinitId,
                'Vault ID': resolvedOwner.vaultId,
                'DNA Record ID': resolvedOwner.dnaRecordId,
                'Certificate ID': resolvedOwner.certificateId,
                'TEP Code': report.identityRecoveryReport?.tepCode ?? 'Not embedded on this file',
                'Original Filename': resolvedOwner.originalFilename,
                'Created': report.owner.createdAt
                  ?? report.identityRecoveryReport?.registrationTimestamp
                  ?? null,
              }).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 py-1 border-b border-bg-border/50">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-white mono text-right truncate min-w-0 max-w-full sm:max-w-[60%]">{formatEvidenceValue(v as string | null | undefined)}</dd>
                </div>
              ))}
            </dl>
          </Section>
          ) : reportState === 'NO_SIGNATURE' ? (
            <Section title="2. Vault Match" icon={User}>
              <p className="text-sm text-red-400">No PINIT signature found — no vault owner details to display.</p>
              {report.summary.decisionReason && (
                <p className="text-xs text-gray-500 mt-2">{report.summary.decisionReason}</p>
              )}
            </Section>
          ) : null}

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
                {report.pipeline.some((s) => s.id === 'dna_compare' && s.detail?.includes('estimated')) && (
                  <p className="text-xs text-amber-400/90 mb-2">
                    Deep 15-layer compare did not finish — scores below are estimated from live identity recovery (
                    {report.summary.retrievalConfidence ?? report.summary.dnaMatchPercent}% confidence).
                  </p>
                )}
                {report.layerAnalysis.map((l) => (
                  <div key={l.layer} className="p-2 rounded-lg bg-bg-elevated">
                    <div className="flex items-center gap-3">
                      <span className="text-2xs text-gray-500 w-6 mono">L{l.layer}</span>
                      <span className="flex-1 text-xs text-white truncate">{l.name}</span>
                      <span className="text-xs font-bold text-white mono">{l.matchPercent}%</span>
                      <span className={cn('text-2xs px-2 py-0.5 rounded-full uppercase', LAYER_STATUS[l.status] ?? LAYER_STATUS.skipped)}>
                        {l.status}
                      </span>
                    </div>
                    {l.explanation && (
                      <p className={cn(
                        'text-2xs mt-1.5 pl-9',
                        l.status === 'warning' || l.status === 'failed'
                          ? 'text-amber-400/90'
                          : 'text-gray-500',
                      )}>
                        {l.explanation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="5. Tamper Analysis — What Changed vs Original"
            icon={AlertTriangle}
            defaultOpen={
              report.tamperAnalysis.overallTamperScore >= 25
              || (report.tamperAnalysis.changesVsOriginal?.length ?? 0) > 0
              || report.tamperAnalysis.vectors.some((v) => v.detected)
            }
          >
            <p className="text-sm font-bold text-white mb-2">
              Overall Tamper Score: {report.tamperAnalysis.overallTamperScore}%
              <span className="text-gray-500 font-normal ml-2">
                ({TAMPER_VECTOR_LABELS[report.tamperAnalysis.primaryVector]
                  ?? String(report.tamperAnalysis.primaryVector).replace(/_/g, ' ')})
              </span>
            </p>
            {report.tamperAnalysis.description && (
              <p className="text-xs text-gray-400 mb-3">{report.tamperAnalysis.description}</p>
            )}

            {/* Primary: explicit inventry of changes done to the original */}
            {(report.tamperAnalysis.changesVsOriginal?.filter((c) => c.detected).length ?? 0) > 0 ? (
              <div className="mb-4 space-y-2">
                <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
                  Detected changes vs vault original
                </p>
                {report.tamperAnalysis.changesVsOriginal!.filter((c) => c.detected).map((c) => (
                  <div
                    key={`${c.type}-${c.detail.slice(0, 24)}`}
                    className="p-3 rounded-lg border border-orange-500/35 bg-orange-500/10"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold text-orange-300">{c.type}</span>
                      <span className="text-2xs mono text-orange-400/80">{c.confidence}% conf.</span>
                    </div>
                    <p className="text-xs text-white/90">{c.detail}</p>
                    {c.where && (
                      <p className="text-2xs text-gray-400 mt-1">Where: {c.where}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : report.tamperAnalysis.overallTamperScore < 25 ? (
              <p className="text-xs text-green-400/90 mb-3">
                No significant crop, compress, or text changes detected vs the matched original.
              </p>
            ) : null}

            {report.tamperAnalysis.cropDetection && (
              <div className="mb-3 p-2.5 rounded-lg bg-bg-elevated border border-bg-border text-xs space-y-1">
                <p className="font-semibold text-white">Crop / region geometry</p>
                {report.tamperAnalysis.cropDetection.sharedRegionPercent != null && (
                  <p className="text-gray-300">
                    Shared with original: ~{Math.round(report.tamperAnalysis.cropDetection.sharedRegionPercent)}%
                  </p>
                )}
                {(report.tamperAnalysis.cropDetection.cropPercent != null
                  || report.tamperAnalysis.cropDetection.missingPercent != null) && (
                  <p className="text-amber-400">
                    Cropped / missing: ~
                    {Math.round(
                      report.tamperAnalysis.cropDetection.cropPercent
                      ?? report.tamperAnalysis.cropDetection.missingPercent
                      ?? 0,
                    )}%
                  </p>
                )}
                {report.tamperAnalysis.cropDetection.visiblePercent != null && (
                  <p className="text-gray-400">
                    Visible portion: ~{Math.round(report.tamperAnalysis.cropDetection.visiblePercent)}%
                  </p>
                )}
              </div>
            )}

            {report.tamperAnalysis.modifiedPercent != null && (
              <p className="text-xs text-amber-400 mb-2">
                Modified region: {report.tamperAnalysis.modifiedPercent}%
                {report.tamperAnalysis.insertedRegions != null && (
                  <span className="text-gray-500"> · {report.tamperAnalysis.insertedRegions} region(s)</span>
                )}
              </p>
            )}
            {report.tamperAnalysis.overlayPngBase64 && (
              <div className="mb-3 rounded-lg overflow-hidden border border-red-500/30">
                <img
                  src={`data:image/png;base64,${report.tamperAnalysis.overlayPngBase64}`}
                  alt="Tamper localization overlay"
                  className="w-full max-h-64 object-contain bg-black"
                />
                <p className="text-2xs text-gray-500 p-2">Red overlay = modified / inserted vs vault original</p>
              </div>
            )}

            {report.identityRecovery?.transformations?.some((t) => t.detected) && (
              <div className="mb-3 space-y-1">
                <p className="text-2xs font-semibold text-gray-400 uppercase">Leak-path transforms</p>
                {report.identityRecovery.transformations.filter((t) => t.detected).map((t) => (
                  <p key={t.type} className="text-xs text-orange-300">
                    {t.type}{t.detail ? ` — ${t.detail}` : ''}
                  </p>
                ))}
              </div>
            )}

            <p className="text-2xs text-gray-500 mb-2">All detectors</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {report.tamperAnalysis.vectors.map((v) => (
                <div
                  key={v.label}
                  className={cn(
                    'text-xs px-2 py-1.5 rounded-lg border',
                    v.detected
                      ? 'border-orange-500/40 text-orange-400 bg-orange-500/10'
                      : 'border-bg-border text-gray-500',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {v.label}
                      {v.detected ? ' ✓' : ' — Clear'}
                    </span>
                    {v.detected && v.confidence != null && v.confidence > 0 && (
                      <span className="text-2xs mono opacity-70">{v.confidence}%</span>
                    )}
                  </div>
                  {v.detected && v.evidence && v.evidence.length > 0 && (
                    <p className="text-2xs text-orange-300/70 mt-0.5 leading-snug">{v.evidence[0]}</p>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {report.forensicEvidence?.matchReasons && report.forensicEvidence.matchReasons.length > 0 && (
            <Section title="5b. Why It Matched" icon={Fingerprint} defaultOpen>
              <p className="text-xs text-gray-400 mb-3">Matched because:</p>
              <div className="space-y-2">
                {report.forensicEvidence.matchReasons.map((r) => (
                  <div key={r.signal} className="flex items-center gap-3 p-2 rounded-lg bg-bg-elevated">
                    <span className={cn('text-lg', r.matched ? 'text-green-400' : 'text-gray-600')}>
                      {r.matched ? '✓' : '○'}
                    </span>
                    <span className="flex-1 text-xs text-white">{r.label}</span>
                    <span className="text-xs font-bold mono text-dna-400">{r.percent}%</span>
                  </div>
                ))}
              </div>
              {report.forensicEvidence.screenshotDetected && (
                <p className="text-xs text-amber-400 mt-3">
                  Screenshot detected — Platform: {report.forensicEvidence.screenshotPlatform ?? 'unknown'}
                  {report.forensicEvidence.screenshotConfidence != null && (
                    <span> ({report.forensicEvidence.screenshotConfidence}%)</span>
                  )}
                </p>
              )}
              {report.forensicEvidence.aiEdited && (
                <p className="text-xs text-red-400 mt-2">
                  AI edit suspected ({report.forensicEvidence.aiEditConfidence}%): {report.forensicEvidence.aiEditReason}
                </p>
              )}
            </Section>
          )}

          <Section title="6. Evidence Timeline (Chain of Custody)" icon={Clock} defaultOpen>
            <p className="text-2xs text-gray-500 mb-3">
              Append-only forensic history — DNA identity is never modified by these events.
            </p>
            {report.provenanceSummary && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                {[
                  ['Created', report.provenanceSummary.creationTime ? new Date(report.provenanceSummary.creationTime).toLocaleString() : '—'],
                  ['Creation location', report.provenanceSummary.creationLocation ?? '—'],
                  ['Last download', report.provenanceSummary.lastDownload ? new Date(report.provenanceSummary.lastDownload).toLocaleString() : '—'],
                  ['Last protected export', report.provenanceSummary.lastProtectedExport ? new Date(report.provenanceSummary.lastProtectedExport).toLocaleString() : '—'],
                  ['Last known location', report.provenanceSummary.lastKnownLocation ?? '—'],
                  ['Last known device', report.provenanceSummary.lastKnownDevice ?? '—'],
                  ['Downloads', String(report.provenanceSummary.downloadCount)],
                  ['Shares', String(report.provenanceSummary.shareCount)],
                  ['Investigations', String(report.provenanceSummary.investigationCount)],
                  ['Tamper events', String(report.provenanceSummary.tamperCount)],
                  ['Countries seen', report.provenanceSummary.countriesSeen.join(', ') || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-bg-border bg-bg-elevated/40 px-2 py-1.5">
                    <p className="text-2xs text-gray-500">{label}</p>
                    <p className="text-xs text-white truncate" title={value}>{value}</p>
                  </div>
                ))}
              </div>
            )}
            {(report.evidenceTimeline?.length ?? 0) === 0 ? (
              <p className="text-xs text-gray-500">No custody events recorded for this asset yet.</p>
            ) : (
              <div className="space-y-0">
                {report.evidenceTimeline!.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex gap-3 py-2 border-l-2 border-dna-500/30 pl-4 ml-2"
                  >
                    <div className="min-w-0">
                      <p className="text-2xs font-semibold text-dna-300 uppercase tracking-wide">{ev.eventType.replace(/_/g, ' ')}</p>
                      <p className="text-xs font-semibold text-white">{ev.summary}</p>
                      <p className="text-2xs text-gray-500 mono">{new Date(ev.timestamp).toLocaleString()}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-2xs text-gray-400">
                        {ev.locationLabel && <span>{ev.locationLabel}</span>}
                        {ev.actorLabel && <span>{ev.actorLabel}</span>}
                        {ev.device && <span>{ev.device}</span>}
                        {ev.tepCode && <span className="mono">TEP {ev.tepCode}</span>}
                        {ev.certificateId && <span className="mono truncate max-w-[12rem]">{ev.certificateId}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="6b. Session Timeline" icon={Clock} defaultOpen={false}>
            {report.timeline.length === 0 ? (
              <p className="text-xs text-gray-500">No timeline events recorded for this investigation.</p>
            ) : (
              <div className="space-y-0" key={report.investigationId}>
                {report.timeline.map((ev, i) => (
                  <div
                    key={`${report.investigationId}-${ev.stage}-${ev.timestamp ?? i}`}
                    className={cn(
                      'flex gap-3 py-2 border-l-2 pl-4 ml-2',
                      ev.stage.includes('this session')
                        ? 'border-dna-400 bg-dna-500/5 rounded-r-lg'
                        : 'border-dna-500/30',
                    )}
                  >
                    <div>
                      <p className="text-xs font-semibold text-white">{ev.stage}</p>
                      {ev.timestamp && <p className="text-2xs text-gray-500 mono">{ev.timestamp}</p>}
                      {ev.detail && <p className="text-2xs text-gray-400 mt-0.5">{ev.detail}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
            {report.leakIntelligence.leakChain && report.leakIntelligence.leakChain.length > 0 && (
              <div className="mb-4 space-y-0">
                <p className="text-2xs text-gray-500 uppercase tracking-wider mb-2">Leak chain (crawler)</p>
                {report.leakIntelligence.leakChain.map((e, i) => (
                  <div key={i} className="flex gap-3 py-2 border-l-2 border-red-500/30 pl-4 ml-2">
                    <div>
                      <p className="text-xs font-semibold text-red-400">{e.platform}</p>
                      <p className="text-2xs text-gray-500">{e.date ?? '—'} · {e.status}</p>
                    </div>
                  </div>
                ))}
                <p className="text-2xs text-gray-500 mt-2">
                  Current status: {report.leakIntelligence.currentStatus ?? 'Unknown'}
                </p>
              </div>
            )}
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
            {hasVaultMatch && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs mb-4">
              {[
                ['Vault ID', resolvedOwner.vaultId],
                ['DNA Record ID', resolvedOwner.dnaRecordId],
                ['Certificate ID', resolvedOwner.certificateId ?? report.identityProof.certificateId],
                ['Owner PINIT ID', resolvedOwner.ownerPinitId ?? report.identityProof.ownerPinitId],
                ['Digital Signature', (report.identityProof.digitalSignatureValid || hasVaultMatch) ? 'VALID' : 'INVALID'],
                ['Identity Verification', report.identityProof.identityVerification],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between gap-2 py-1 border-b border-bg-border/50">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="text-white mono text-right truncate min-w-0 max-w-full sm:max-w-[60%]">{formatEvidenceValue(v as string | null | undefined)}</dd>
                </div>
              ))}
            </dl>
            )}
            {!hasVaultMatch && (
              <p className="text-sm text-gray-400">No vault identity recovered for this upload.</p>
            )}
          </Section>

          <Section title="10. Evidence Package" icon={FileDown}>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={!!pdfBusy || exporting}
                onClick={async () => {
                  setPdfBusy('investigation');
                  try {
                    await downloadInvestigationReportPdf(asExportReport(report), pdfExportOptions);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to build Investigation Report PDF');
                  } finally {
                    setPdfBusy(null);
                  }
                }}
              >
                {pdfBusy === 'investigation'
                  ? <RefreshCw size={12} className="animate-spin" />
                  : <Download size={12} />}
                {pdfBusy === 'investigation' ? ' Building PDF…' : ' Investigation Report (PDF)'}
              </button>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={!!pdfBusy || exporting}
                onClick={async () => {
                  setPdfBusy('dna');
                  try {
                    await downloadDnaReportPdf(asExportReport(report));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to build DNA Report PDF');
                  } finally {
                    setPdfBusy(null);
                  }
                }}
              >
                {pdfBusy === 'dna'
                  ? <RefreshCw size={12} className="animate-spin" />
                  : <Dna size={12} />}
                {pdfBusy === 'dna' ? ' Building PDF…' : ' DNA Report (PDF)'}
              </button>
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={!!pdfBusy || exporting}
                onClick={async () => {
                  setPdfBusy('timeline');
                  try {
                    await downloadTimelineReportPdf(asExportReport(report));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to build Timeline Report PDF');
                  } finally {
                    setPdfBusy(null);
                  }
                }}
              >
                {pdfBusy === 'timeline'
                  ? <RefreshCw size={12} className="animate-spin" />
                  : <Clock size={12} />}
                {pdfBusy === 'timeline' ? ' Building PDF…' : ' Timeline Report (PDF)'}
              </button>
              <button
                type="button"
                className="btn btn-primary text-xs"
                disabled={exporting || !!pdfBusy}
                onClick={async () => {
                  setExporting(true);
                  try {
                    await downloadEvidencePackageZip(asExportReport(report), pdfExportOptions);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to build Evidence Package ZIP');
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
                disabled={!!pdfBusy || exporting}
                onClick={() => { void downloadAdvancedExportJson(asExportReport(report)); }}
              >
                <FileDown size={12} /> Advanced Export (JSON)
              </button>
            </div>
            {(pdfBusy || exporting) && (
              <p className="text-2xs text-cyan-600 mt-2">
                {pdfBusy
                  ? 'Generating PDF (embedding comparison images + signing)… your download will start when ready.'
                  : 'Building evidence ZIP…'}
              </p>
            )}
            <p className="text-2xs text-gray-600 mt-3">
              PDFs are archived to Forensic Reports automatically when an investigation finishes — you do not need to download first.
              Evidence ZIP includes PDF reports, JSON artifacts, pipeline logs, and screenshot folder placeholder.
              Legal Evidence Bundle — coming soon.
            </p>
          </Section>
        </div>
        );
      })()}
    </div>
  );
}
