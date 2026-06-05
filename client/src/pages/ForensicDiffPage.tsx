/**
 * PINIT-DNA — Forensic Difference Engine Page
 * Route: /forensic-diff
 *
 * Upload two files, get a full forensic difference analysis:
 * text diffs, pixel heatmaps, metadata changes, severity.
 */

import { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Upload, X, RefreshCw, AlertTriangle, CheckCircle2,
  FileText, Image, Tag, ChevronDown, ChevronUp, Shield,
  Minus, Plus, Edit3, Info,
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../config/api.config';
import { Badge } from '../components/ui/Badge';
import { cn } from '../components/ui/utils';
import { formatBytes } from '../hooks/useApi';
import type { ForensicDiffReport } from '../../../src/types/forensic-diff.types';

// ─── Severity helpers ─────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, { text: string; bg: string; border: string }> = {
  NONE:     { text: 'text-success', bg: 'bg-success/10',  border: 'border-success/30'  },
  LOW:      { text: 'text-info',    bg: 'bg-info/10',     border: 'border-info/30'     },
  MEDIUM:   { text: 'text-warning', bg: 'bg-warning/10',  border: 'border-warning/30'  },
  HIGH:     { text: 'text-orange',  bg: 'bg-orange/10',   border: 'border-orange/30'   },
  CRITICAL: { text: 'text-danger',  bg: 'bg-danger/10',   border: 'border-danger/30'   },
};

const SEV_ICON: Record<string, React.ReactNode> = {
  NONE:     <CheckCircle2 size={18} className="text-success" />,
  LOW:      <Info size={18} className="text-info" />,
  MEDIUM:   <AlertTriangle size={18} className="text-warning" />,
  HIGH:     <AlertTriangle size={18} className="text-orange" />,
  CRITICAL: <AlertTriangle size={18} className="text-danger" />,
};

// ─── Image Heatmap (Canvas) ───────────────────────────────────────────────────

function ImageHeatmap({ imageDiff, fileB }: {
  imageDiff: ForensicDiffReport['imageDiff'];
  fileB: File | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const drawHeatmap = useCallback(() => {
    if (!canvasRef.current || !imageDiff?.changedRegions) return;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width  = imageDiff.widthB  || 400;
    canvas.height = imageDiff.heightB || 400;

    const cW = canvas.width;
    const cH = canvas.height;
    // Draw base image if available
    if (imageUrl) {
      const img = new window.Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, cW, cH);
        drawOverlay(ctx, cW, cH);
      };
      img.src = imageUrl;
    } else {
      ctx.fillStyle = '#0f1623';
      ctx.fillRect(0, 0, cW, cH);
      drawOverlay(ctx, cW, cH);
    }
  }, [imageDiff, imageUrl]);

  const drawOverlay = (ctx: CanvasRenderingContext2D, _W: number, _H: number) => {
    if (!imageDiff?.changedRegions) return;
    for (const region of imageDiff.changedRegions) {
      const alpha = Math.min(region.changeIntensity * 0.7, 0.85);
      // Red to yellow gradient based on intensity
      const r = 255;
      const g = Math.round(255 * (1 - region.changeIntensity));
      ctx.fillStyle = `rgba(${r},${g},0,${alpha})`;
      ctx.fillRect(region.x, region.y, region.width, region.height);

      // Border
      ctx.strokeStyle = `rgba(255,100,0,0.9)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(region.x, region.y, region.width, region.height);
    }
  };

  // Load fileB as image for background
  if (fileB && !imageUrl && fileB.type.startsWith('image/')) {
    const url = URL.createObjectURL(fileB);
    setImageUrl(url);
  }

  // Draw on mount/update
  const ref = useCallback((node: HTMLCanvasElement | null) => {
    if (node) { (canvasRef as React.MutableRefObject<HTMLCanvasElement>).current = node; drawHeatmap(); }
  }, [drawHeatmap]);

  if (!imageDiff?.heatmapAvailable) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-300">Changed Regions Heatmap</p>
      <p className="text-2xs text-gray-500">
        Red = high change intensity · Yellow = moderate change · {imageDiff.changedRegions.length} regions detected
      </p>
      <div className="rounded-xl overflow-hidden border border-bg-border bg-bg-elevated">
        <canvas
          ref={ref}
          className="w-full max-h-64 object-contain"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>
    </div>
  );
}

// ─── Diff Chunk Row ───────────────────────────────────────────────────────────

function DiffChunk({ chunk }: { chunk: ForensicDiffReport['textDiff'] extends null ? never : NonNullable<ForensicDiffReport['textDiff']>['chunks'][0] }) {
  const colors = {
    added:     { bg: 'bg-success/10 border-success/20', icon: <Plus size={12} className="text-success" />, text: 'text-success' },
    removed:   { bg: 'bg-danger/10 border-danger/20',   icon: <Minus size={12} className="text-danger" />, text: 'text-danger' },
    modified:  { bg: 'bg-warning/10 border-warning/20', icon: <Edit3 size={12} className="text-warning" />, text: 'text-warning' },
    unchanged: { bg: 'bg-bg-elevated border-bg-border', icon: null, text: 'text-gray-500' },
  };
  const cfg = colors[chunk.type] ?? colors.unchanged;

  return (
    <div className={cn('rounded-lg border p-3 flex gap-2', cfg.bg)}>
      <div className="mt-0.5 shrink-0">{cfg.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn('text-2xs font-semibold uppercase', cfg.text)}>{chunk.type}</span>
          <span className="text-2xs text-gray-600 mono">{chunk.location}</span>
          <span className="text-2xs text-gray-600">{chunk.wordCount} words</span>
        </div>
        <p className="text-xs text-gray-300 mono break-all leading-relaxed">
          {chunk.content.slice(0, 300)}{chunk.content.length > 300 ? '…' : ''}
        </p>
      </div>
    </div>
  );
}

// ─── Section Panel ────────────────────────────────────────────────────────────

function CollapsibleSection({ title, icon, count, children }: {
  title: string; icon: React.ReactNode; count?: number; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="card p-0 overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-bg-elevated/40 transition-colors">
        {icon}
        <span className="text-sm font-semibold text-white flex-1">{title}</span>
        {count !== undefined && <Badge variant="dna">{count}</Badge>}
        {open ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="overflow-hidden">
            <div className="border-t border-bg-border px-5 py-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── File Drop Zone ───────────────────────────────────────────────────────────

function DropZone({ label, file, onFile, onClear }: {
  label: string; file: File | null;
  onFile: (f: File) => void; onClear: () => void;
}) {
  const onDrop = useCallback((accepted: File[]) => { if (accepted[0]) onFile(accepted[0]); }, [onFile]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, maxFiles: 1 });

  return (
    <div className="flex-1">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      <div {...getRootProps()} className={cn(
        'rounded-xl border-2 border-dashed cursor-pointer transition-all',
        isDragActive ? 'border-dna-500 bg-dna-500/10'
          : file      ? 'border-success/50 bg-success/5'
          : 'border-bg-border bg-bg-elevated hover:border-dna-500/40'
      )}>
        <input {...getInputProps()} />
        {file ? (
          <div className="flex items-center gap-3 p-4">
            <FileText size={20} className="text-success shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{file.name}</p>
              <p className="text-2xs text-gray-500 mono">{formatBytes(file.size)}</p>
            </div>
            <button onClick={e => { e.stopPropagation(); onClear(); }}
              className="text-gray-500 hover:text-danger">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center py-8 px-4 text-center">
            <Upload size={20} className="text-gray-600 mb-2" />
            <p className="text-sm text-gray-400">{isDragActive ? 'Drop here' : 'Drop or click to upload'}</p>
            <p className="text-2xs text-gray-600 mt-1">Any file type</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ForensicDiffPage() {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [report, setReport]   = useState<ForensicDiffReport | null>(null);

  const canAnalyze = fileA && fileB && !loading;

  const handleAnalyze = async () => {
    if (!fileA || !fileB) return;
    setLoading(true); setReport(null);
    try {
      const form = new FormData();
      form.append('fileA', fileA);
      form.append('fileB', fileB);
      const { data } = await axios.post<ForensicDiffReport & { success: boolean }>(
        `${API_BASE_URL}/forensic/diff`, form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setReport(data);
      toast.success('Forensic analysis complete');
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      toast.error(e?.response?.data?.error ?? e?.message ?? 'Analysis failed');
    } finally { setLoading(false); }
  };

  const sevCfg = report ? SEV_COLOR[report.overallSeverity] ?? SEV_COLOR.NONE : null;

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Forensic Difference Engine</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Explains WHAT changed, WHERE, and HOW SEVERELY — not just similarity scores
          </p>
        </div>
        {report && (
          <button onClick={() => { setReport(null); setFileA(null); setFileB(null); }}
            className="btn btn-secondary btn-sm">
            <RefreshCw size={13} /> New Analysis
          </button>
        )}
      </div>

      {/* Upload panel */}
      {!report && (
        <div className="card">
          <div className="flex items-center gap-2 mb-5">
            <Search size={18} className="text-dna-400" />
            <h2 className="text-sm font-semibold text-white">Upload Files to Analyse</h2>
          </div>
          <div className="flex gap-4 mb-5">
            <DropZone label="File A — Original" file={fileA} onFile={setFileA} onClear={() => setFileA(null)} />
            <div className="flex items-center text-gray-600"><Search size={18} /></div>
            <DropZone label="File B — Modified" file={fileB} onFile={setFileB} onClear={() => setFileB(null)} />
          </div>
          <button onClick={handleAnalyze} disabled={!canAnalyze} className="btn btn-primary w-full btn-lg">
            {loading
              ? <><RefreshCw size={16} className="animate-spin" /> Analysing differences…</>
              : <><Search size={16} /> Run Forensic Difference Analysis</>}
          </button>
          {loading && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {['Text Diff', 'Image Diff', 'Metadata Diff'].map((s, i) => (
                <div key={s} className="bg-bg-elevated rounded-lg p-2">
                  <motion.div className="h-1 bg-dna-500 rounded-full mb-1"
                    initial={{ width: '0%' }} animate={{ width: '100%' }}
                    transition={{ duration: 2, delay: i * 0.3, ease: 'easeInOut' }} />
                  <p className="text-2xs text-gray-500">{s}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {report && sevCfg && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

          {/* Summary banner */}
          <div className={cn('rounded-2xl border p-5', sevCfg.bg, sevCfg.border)}>
            <div className="flex items-start gap-4 mb-4">
              <div className="mt-0.5">{SEV_ICON[report.overallSeverity]}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={cn('text-xl font-bold', sevCfg.text)}>{report.overallSeverity}</span>
                  <Badge variant="dna">{report.changeClassification}</Badge>
                  <span className="text-xs text-gray-500 mono">{report.processingMs}ms</span>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">{report.forensicSummary}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-bold text-white">{Math.round(report.overallConfidence * 100)}%</p>
                <p className="text-2xs text-gray-500">confidence</p>
              </div>
            </div>

            {/* Files */}
            <div className="grid grid-cols-2 gap-3">
              {[report.fileA, report.fileB].map((f, i) => (
                <div key={i} className="bg-black/20 rounded-xl p-3">
                  <p className="text-2xs text-gray-500 mb-0.5">File {String.fromCharCode(65+i)}</p>
                  <p className="text-sm font-medium text-white truncate">{f.filename}</p>
                  <div className="flex gap-2 mt-1">
                    <Badge variant="dna">{f.fileType}</Badge>
                    <span className="text-2xs text-gray-600 mono">{formatBytes(f.sizeBytes)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* What/Where/How */}
          {(report.whatChanged.length > 0 || report.whereChanged.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { label: 'What Changed', items: report.whatChanged,  color: 'text-danger'  },
                { label: 'Where',        items: report.whereChanged, color: 'text-warning' },
                { label: 'How',          items: report.howChanged,   color: 'text-info'    },
              ].map(col => col.items.length > 0 && (
                <div key={col.label} className="card-sm">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{col.label}</p>
                  <ul className="space-y-1">
                    {col.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className={cn('text-2xs mt-0.5', col.color)}>▸</span>
                        <span className="text-xs text-gray-300">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Text Diff */}
          {report.textDiff?.supported && (
            <CollapsibleSection
              title="Text Content Differences"
              icon={<FileText size={16} className="text-dna-400" />}
              count={report.textDiff.addedLines + report.textDiff.removedLines}
            >
              {/* Stats row */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Added Lines',   value: report.textDiff.addedLines,   color: 'text-success' },
                  { label: 'Removed Lines', value: report.textDiff.removedLines, color: 'text-danger'  },
                  { label: 'Changed',       value: `${report.textDiff.changePercent}%`, color: 'text-warning' },
                  { label: 'Total Lines',   value: report.textDiff.totalLines,   color: 'text-gray-300' },
                ].map(s => (
                  <div key={s.label} className="bg-bg-elevated rounded-lg p-2.5 text-center">
                    <p className={cn('text-lg font-bold', s.color)}>{s.value}</p>
                    <p className="text-2xs text-gray-500">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Section diffs */}
              {report.textDiff.sectionDiffs.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-400 mb-2">Section / Page Changes</p>
                  <div className="space-y-1.5">
                    {report.textDiff.sectionDiffs.map((s, i) => (
                      <div key={i} className="flex items-center gap-3 bg-bg-elevated rounded-lg px-3 py-2">
                        <span className="text-2xs font-mono text-gray-400 w-20 shrink-0">{s.sectionName}</span>
                        <div className="flex-1 h-1.5 bg-bg-base rounded-full overflow-hidden">
                          <div className="h-full bg-warning rounded-full"
                            style={{ width: `${Math.min(s.changePercent, 100)}%` }} />
                        </div>
                        <span className="text-2xs text-warning mono w-10 text-right">{s.changePercent}%</span>
                        <Badge variant={s.type === 'added' ? 'success' : s.type === 'removed' ? 'danger' : 'warning'}>
                          {s.type}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Diff chunks */}
              {report.textDiff.chunks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400">Top Changed Content</p>
                  {report.textDiff.chunks.slice(0, 8).map((chunk, i) => (
                    <DiffChunk key={i} chunk={chunk} />
                  ))}
                </div>
              )}

              {/* JSON/CSV structured diff */}
              {report.textDiff.structuredDiff && (
                <div className="mt-4 space-y-2">
                  {(['added','removed','modified'] as const).map(type =>
                    (report.textDiff!.structuredDiff![type] as string[])?.length > 0 && (
                      <div key={type} className={cn('rounded-lg p-3 border',
                        type === 'added' ? 'bg-success/10 border-success/20'
                          : type === 'removed' ? 'bg-danger/10 border-danger/20'
                          : 'bg-warning/10 border-warning/20'
                      )}>
                        <p className="text-2xs font-semibold uppercase mb-1.5">{type}</p>
                        {(report.textDiff!.structuredDiff![type] as string[]).slice(0, 5).map((item: string, i: number) => (
                          <p key={i} className="text-xs text-gray-300 mono">{item}</p>
                        ))}
                      </div>
                    )
                  )}
                </div>
              )}
            </CollapsibleSection>
          )}

          {/* Image Diff */}
          {report.imageDiff?.supported && (
            <CollapsibleSection
              title="Image Pixel Analysis"
              icon={<Image size={16} className="text-purple" />}
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Pixel Diff',  value: `${report.imageDiff.pixelDifferencePercent}%`, ok: report.imageDiff.pixelDifferencePercent < 1 },
                  { label: 'Resized',     value: report.imageDiff.resizeDetected ? 'YES' : 'NO', ok: !report.imageDiff.resizeDetected },
                  { label: 'Cropped',     value: report.imageDiff.cropDetected   ? 'YES' : 'NO', ok: !report.imageDiff.cropDetected   },
                  { label: 'Compression', value: report.imageDiff.compressionChanged ? 'Changed' : 'Same', ok: !report.imageDiff.compressionChanged },
                ].map(s => (
                  <div key={s.label} className="bg-bg-elevated rounded-lg p-2.5 text-center">
                    <p className={cn('text-lg font-bold', s.ok ? 'text-success' : 'text-warning')}>{s.value}</p>
                    <p className="text-2xs text-gray-500">{s.label}</p>
                  </div>
                ))}
              </div>

              {!report.imageDiff.dimensionsMatch && (
                <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 mb-4">
                  <p className="text-xs text-warning font-semibold">Dimensions changed</p>
                  <p className="text-2xs text-gray-400 mt-1">
                    Original: {report.imageDiff.widthA}×{report.imageDiff.heightA}px →
                    Modified: {report.imageDiff.widthB}×{report.imageDiff.heightB}px
                  </p>
                </div>
              )}

              <p className="text-xs text-gray-400 mb-3">{report.imageDiff.visualDescription}</p>
              <ImageHeatmap imageDiff={report.imageDiff} fileB={fileB} />
            </CollapsibleSection>
          )}

          {/* Metadata Diff */}
          {report.metadataDiff && report.metadataDiff.totalChanges > 0 && (
            <CollapsibleSection
              title="Metadata Differences"
              icon={<Tag size={16} className="text-cyan" />}
              count={report.metadataDiff.totalChanges}
            >
              <p className="text-xs text-gray-400 mb-3">{report.metadataDiff.summary}</p>
              <div className="space-y-2">
                {report.metadataDiff.changes.map((c, i) => (
                  <div key={i} className={cn(
                    'rounded-xl border p-3',
                    c.significance === 'high'   ? 'border-danger/30 bg-danger/5'
                    : c.significance === 'medium' ? 'border-warning/30 bg-warning/5'
                    : 'border-bg-border bg-bg-elevated'
                  )}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-white">{c.field}</span>
                      <Badge variant={c.changeType === 'added' ? 'success' : c.changeType === 'removed' ? 'danger' : 'warning'}>
                        {c.changeType}
                      </Badge>
                      <Badge variant={c.significance === 'high' ? 'danger' : c.significance === 'medium' ? 'warning' : 'muted'}>
                        {c.significance}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div className="bg-black/20 rounded p-2">
                        <p className="text-2xs text-gray-500">Before</p>
                        <p className="text-xs text-gray-200 mono">{c.before ?? '(empty)'}</p>
                      </div>
                      <div className="bg-black/20 rounded p-2">
                        <p className="text-2xs text-gray-500">After</p>
                        <p className="text-xs text-gray-200 mono">{c.after ?? '(empty)'}</p>
                      </div>
                    </div>
                    <p className="text-2xs text-gray-500 italic">{c.forensicNote}</p>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Evidence */}
          {report.evidence.length > 0 && (
            <CollapsibleSection
              title="Forensic Evidence"
              icon={<Shield size={16} className="text-dna-400" />}
              count={report.evidence.length}
            >
              <div className="space-y-2">
                {report.evidence.map((e, i) => {
                  const sev = SEV_COLOR[e.severity] ?? SEV_COLOR.LOW;
                  return (
                    <div key={i} className={cn('rounded-xl border p-3', sev.bg, sev.border)}>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={
                          e.severity === 'CRITICAL' ? 'danger' : e.severity === 'HIGH' ? 'orange' :
                          e.severity === 'MEDIUM' ? 'warning' : 'info'
                        }>{e.severity}</Badge>
                        <span className="text-xs font-semibold text-gray-300">{e.category}</span>
                        <span className="text-2xs text-gray-600 mono ml-auto">
                          {Math.round(e.confidence * 100)}% confidence
                        </span>
                      </div>
                      <p className="text-xs text-gray-300">{e.finding}</p>
                      <p className="text-2xs text-gray-500 mt-1">Location: {e.location}</p>
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          )}

          {/* Recommendation */}
          <div className="card-sm bg-bg-elevated border-dna-500/20">
            <p className="text-2xs font-semibold text-dna-400 uppercase tracking-wider mb-1">Forensic Recommendation</p>
            <p className="text-sm text-gray-300">{report.recommendation}</p>
            <p className="text-2xs text-gray-500 mt-2">{report.evidenceSummary}</p>
          </div>

        </motion.div>
      )}
    </div>
  );
}
