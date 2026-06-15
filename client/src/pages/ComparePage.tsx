import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitCompare, Upload, X, CheckCircle2, AlertTriangle,
  Shield, RefreshCw, ChevronDown, ChevronUp, FileText,
  Fingerprint, Eye, Lock, Tag, Cpu,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { compareDna } from '../services/dashboard.api';
import { Badge, ClassificationBadge } from '../components/ui/Badge';
import { formatBytes } from '../hooks/useApi';
import type { ComparisonResult, LayerComparison } from '../types/dashboard.types';
import { cn } from '../components/ui/utils';

// ─── Layer icons ──────────────────────────────────────────────────────────────
const LAYER_ICONS = [Fingerprint, Cpu, Eye, Tag, FileText, Lock];
const LAYER_NAMES = ['Cryptographic', 'Structural', 'Perceptual', 'Semantic', 'Metadata', 'Signature'];

function getFileIcon(file: File): string {
  const mime = file.type;
  if (mime.startsWith('image/'))   return '🖼️';
  if (mime === 'application/pdf')  return '📄';
  if (mime.includes('word'))       return '📝';
  if (mime.includes('present'))    return '📊';
  if (mime === 'text/plain')       return '📃';
  if (mime === 'text/csv')         return '📋';
  if (mime === 'application/json') return '🗃️';
  if (mime === 'application/zip')  return '🗜️';
  if (mime.startsWith('video/'))   return '🎬';
  if (mime.startsWith('audio/'))   return '🎵';
  return '📁';
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function FileDropZone({
  label, file, onFile, onClear,
}: {
  label: string; file: File | null;
  onFile: (f: File) => void; onClear: () => void;
}) {
  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) onFile(accepted[0]);
  }, [onFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, maxFiles: 1, maxSize: 500 * 1024 * 1024,
  });

  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      <div
        {...getRootProps()}
        className={cn(
          'relative rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200',
          isDragActive      ? 'border-dna-500 bg-dna-500/10 glow-purple'
            : file          ? 'border-success/50 bg-success/5 glow-green'
            : 'border-bg-border bg-bg-elevated hover:border-dna-500/40 hover:bg-bg-muted'
        )}
      >
        <input {...getInputProps()} />
        {file ? (
          <div className="flex items-center gap-3 p-4">
            <span className="text-3xl">{getFileIcon(file)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{file.name}</p>
              <p className="text-xs text-gray-500 mono">{formatBytes(file.size)} · {file.type || 'unknown'}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="btn-icon btn-ghost text-gray-500 hover:text-danger shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <Upload size={20} className="text-gray-600 mb-2" />
            <p className="text-sm text-gray-400 font-medium">
              {isDragActive ? 'Drop here' : 'Drop or click to upload'}
            </p>
            <p className="text-xs text-gray-600 mt-1">Any file type · max 500MB</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Layer comparison bar ─────────────────────────────────────────────────────

function LayerBar({ layer, expanded, onToggle }: {
  layer: LayerComparison; expanded: boolean; onToggle: () => void;
}) {
  const Icon = LAYER_ICONS[layer.layer - 1] ?? Fingerprint;
  const name = LAYER_NAMES[layer.layer - 1] ?? layer.name;
  const pct = layer.similarityPercent;
  const barColor = pct >= 90 ? 'bg-success' : pct >= 60 ? 'bg-warning' : 'bg-danger';
  const textColor = pct >= 90 ? 'text-success' : pct >= 60 ? 'text-warning' : 'text-danger';

  return (
    <div className={cn(
      'rounded-xl border transition-all duration-150',
      layer.matched ? 'border-bg-border bg-bg-elevated' : 'border-danger/20 bg-danger/5'
    )}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
          layer.matched ? 'bg-success/15' : 'bg-danger/15'
        )}>
          <Icon size={14} className={layer.matched ? 'text-success' : 'text-danger'} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-semibold text-white">L{layer.layer} · {name}</span>
            <span className="text-2xs text-gray-600 mono">{layer.implementation}</span>
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-bg-base rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: layer.layer * 0.08 }}
                className={`h-full rounded-full ${barColor}`}
              />
            </div>
            <span className={`text-xs font-bold mono shrink-0 ${textColor}`}>{pct}%</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {layer.matched
            ? <CheckCircle2 size={14} className="text-success" />
            : <AlertTriangle size={14} className="text-danger" />}
          {expanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        </div>
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2 border-t border-bg-border mt-0 pt-3">
              <p className="text-xs text-gray-400">{layer.changeDescription}</p>
              {layer.fingerprintA && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-bg-base rounded-lg p-2.5">
                    <p className="text-2xs text-gray-600 mb-1">File A fingerprint</p>
                    <p className="mono text-2xs text-dna-400 break-all">{layer.fingerprintA.slice(0, 32)}…</p>
                  </div>
                  <div className="bg-bg-base rounded-lg p-2.5">
                    <p className="text-2xs text-gray-600 mb-1">File B fingerprint</p>
                    <p className={cn('mono text-2xs break-all', layer.changed ? 'text-danger/80' : 'text-success/80')}>
                      {layer.fingerprintB.slice(0, 32)}…
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Confidence Ring ──────────────────────────────────────────────────────────

function ConfidenceRing({ score }: { score: number }) {
  const radius = 44;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;
  const color = score >= 90 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col items-center">
      <svg width={110} height={110} className="-rotate-90">
        <circle cx={55} cy={55} r={radius} fill="none" stroke="#1e293b" strokeWidth={8} />
        <motion.circle
          cx={55} cy={55} r={radius}
          fill="none" stroke={color} strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-bold text-white">{score}%</span>
        <span className="text-2xs text-gray-500">confidence</span>
      </div>
    </div>
  );
}

// ─── Result Panel ─────────────────────────────────────────────────────────────

function ResultPanel({ result }: { result: ComparisonResult }) {
  const [expandedLayer, setExpandedLayer] = useState<number | null>(null);
  const classColor = {
    DNA_MATCH: 'border-success/30 bg-success/5',
    SIMILAR:   'border-warning/30 bg-warning/5',
    DIFFERENT: 'border-danger/30 bg-danger/5',
  }[result.classification] ?? '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Summary banner */}
      <div className={cn('rounded-xl border p-5', classColor)}>
        <div className="flex items-center gap-4">
          {/* Ring */}
          <div className="relative shrink-0">
            <ConfidenceRing score={result.overallConfidenceScore} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <ClassificationBadge value={result.classification} />
              {result.tamperingDetected && (
                <Badge variant="danger" dot pulse>Tampering Detected</Badge>
              )}
              {!result.sameFileType && (
                <Badge variant="warning">Cross-type comparison</Badge>
              )}
            </div>
            <p className="text-sm text-gray-300 leading-relaxed">
              {result.forensicReport.summary}
            </p>
          </div>
        </div>

        {/* Quick stats row */}
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/10">
          <div className="text-center">
            <p className="text-lg font-bold text-success">{result.matchedLayers.length}</p>
            <p className="text-2xs text-gray-500">Layers Matched</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-danger">{result.changedLayers.length}</p>
            <p className="text-2xs text-gray-500">Layers Changed</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-white">{result.processingMs}ms</p>
            <p className="text-2xs text-gray-500">Processing Time</p>
          </div>
        </div>
      </div>

      {/* File comparison header */}
      <div className="grid grid-cols-2 gap-3">
        {[result.fileA, result.fileB].map((f, i) => (
          <div key={i} className="card-sm">
            <p className="text-2xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              File {String.fromCharCode(65 + i)} — Original
            </p>
            <p className="text-sm font-medium text-white truncate">{f.filename}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <Badge variant="dna">{f.fileType}</Badge>
              <span className="text-2xs text-gray-600 mono">{formatBytes(f.sizeBytes)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Layer-by-layer breakdown */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Layer-by-Layer Analysis</h3>
        <div className="space-y-2">
          {result.layerComparisons.map(layer => (
            <LayerBar
              key={layer.layer}
              layer={layer}
              expanded={expandedLayer === layer.layer}
              onToggle={() => setExpandedLayer(expandedLayer === layer.layer ? null : layer.layer)}
            />
          ))}
        </div>
      </div>

      {/* Tampering indicators */}
      {result.forensicReport.tamperingIndicators.length > 0 && (
        <div className="card border-danger/20">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={16} className="text-danger" />
            <h3 className="text-sm font-semibold text-white">Tampering Indicators</h3>
          </div>
          <div className="space-y-2">
            {result.forensicReport.tamperingIndicators.map((ind, i) => {
              const sevColor: Record<string, string> = {
                CRITICAL: 'border-danger/40 bg-danger/10',
                HIGH:     'border-orange/40 bg-orange/10',
                MEDIUM:   'border-warning/40 bg-warning/10',
                LOW:      'border-info/40 bg-info/10',
              };
              return (
                <div key={i} className={cn('rounded-lg border p-3', sevColor[ind.severity] ?? '')}>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={ind.severity === 'CRITICAL' ? 'danger' : ind.severity === 'HIGH' ? 'orange' : ind.severity === 'MEDIUM' ? 'warning' : 'info'}>
                      {ind.severity}
                    </Badge>
                    <span className="text-xs font-semibold text-white">{ind.description}</span>
                  </div>
                  <p className="text-2xs text-gray-400">{ind.evidence}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendation */}
      <div className="card-sm bg-bg-elevated border-dna-500/20">
        <p className="text-2xs font-semibold text-dna-400 uppercase tracking-wider mb-2">Recommendation</p>
        <p className="text-sm text-gray-300">{result.forensicReport.recommendation}</p>
      </div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ComparePage() {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);

  const canCompare = fileA && fileB && !loading;

  const handleCompare = async () => {
    if (!fileA || !fileB) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await compareDna(fileA, fileB);
      setResult(res);
      // Persist to sessionStorage for Reports page
      try {
        const existing = JSON.parse(sessionStorage.getItem('pinit_dna_reports') ?? '[]');
        existing.unshift(res);
        sessionStorage.setItem('pinit_dna_reports', JSON.stringify(existing.slice(0, 50)));
      } catch { /* ignore storage errors */ }
      toast.success('Comparison complete');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFileA(null); setFileB(null); setResult(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">DNA Comparison</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Layer-by-layer forensic analysis with tampering detection
          </p>
        </div>
        {result && (
          <button onClick={handleReset} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} /> New Comparison
          </button>
        )}
      </div>

      {/* Upload section — hide when result is shown */}
      {!result && (
        <div className="card">
          <div className="flex items-center gap-2 mb-5">
            <GitCompare size={18} className="text-dna-400" />
            <h2 className="text-sm font-semibold text-white">Upload Files to Compare</h2>
          </div>

          {/* Drop zones */}
          <div className="flex gap-4 mb-5">
            <FileDropZone label="File A — Original" file={fileA} onFile={setFileA} onClear={() => setFileA(null)} />
            <div className="flex items-center justify-center shrink-0 text-gray-600">
              <GitCompare size={20} />
            </div>
            <FileDropZone label="File B — Comparison" file={fileB} onFile={setFileB} onClear={() => setFileB(null)} />
          </div>

          {/* Status hints */}
          {(!fileA || !fileB) && (
            <p className="text-xs text-gray-600 text-center mb-4">
              Upload both files to enable comparison · Supports all 10 file types · Cross-type comparison allowed
            </p>
          )}

          {/* Compare button */}
          <button
            onClick={handleCompare}
            disabled={!canCompare}
            className="btn btn-primary w-full btn-lg"
          >
            {loading ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                Analysing DNA layers…
              </>
            ) : (
              <>
                <GitCompare size={16} />
                Compare DNA Fingerprints
              </>
            )}
          </button>

          {loading && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-center text-gray-500">Running all 10 fingerprint layers in parallel…</p>
              <div className="grid grid-cols-10 gap-1">
                {LAYER_NAMES.map((_name, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div className="w-full h-1 bg-bg-elevated rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-dna-500 rounded-full"
                        initial={{ width: '0%' }}
                        animate={{ width: '100%' }}
                        transition={{ duration: 1.5, delay: i * 0.2, ease: 'easeInOut', repeat: Infinity }}
                      />
                    </div>
                    <span className="text-2xs text-gray-600">L{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {result && <ResultPanel result={result} />}
    </div>
  );
}
