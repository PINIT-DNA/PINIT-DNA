/**
 * Whole-file authenticity report — one score panel + WHY evidence.
 * Used after DNA protect (SuccessPanel) and Digital Assets Details.
 */
import { Microscope, ChevronRight, Shield, AlertTriangle, Sparkles } from 'lucide-react';
import { Badge } from './ui/Badge';
import type { VaultContentAnalysis } from '../types/dashboard.types';

interface Props {
  analysis: VaultContentAnalysis;
  compact?: boolean;
  title?: string;
}

function Meter({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div>
      <div className="flex items-center justify-between text-2xs mb-0.5">
        <span className="text-gray-600 dark:text-gray-300">{label}</span>
        <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{v}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function verdictBadgeVariant(
  verdict: string,
): 'success' | 'warning' | 'danger' | 'info' | 'muted' {
  const v = verdict.toUpperCase();
  if (v === 'ORIGINAL' || v === 'DOCUMENT' || v === 'COURSE_MATERIAL') return 'success';
  if (v === 'SUSPICIOUS' || v === 'LIKELY_EDITED' || v === 'LIKELY_AI' || v === 'RECOMPRESSED' || v === 'METADATA_MODIFIED' || v === 'SCREENSHOT') {
    return 'warning';
  }
  if (v === 'AI_GENERATED' || v === 'DEEPFAKE' || v === 'TAMPERED' || v === 'EDITED') return 'danger';
  return 'info';
}

export function AuthenticityReportCard({
  analysis,
  compact = false,
  title = 'Image analysis',
}: Props) {
  if (analysis.signals?.isImage === false || analysis.signals?.fileCategory && analysis.signals.fileCategory !== 'IMAGE') {
    return null;
  }
  const verdict = analysis.verdictDisplay ?? analysis.labelDisplay ?? analysis.verdict ?? analysis.label;
  const scores = analysis.scores;
  const mix = analysis.composition ?? {
    manualPercent: 100,
    aiGeneratedPercent: 0,
    editedPercent: 0,
    screenshotPercent: 0,
    courseMaterialPercent: 0,
    tamperedPercent: 0,
    recompressedPercent: 0,
  };
  const confidenceRaw = scores?.confidence ?? analysis.confidence ?? 0;
  const confidencePct = confidenceRaw <= 1
    ? Math.round(confidenceRaw * 100)
    : Math.round(confidenceRaw);

  const mixSegments = [
    { key: 'manualPercent' as const, label: 'Original', color: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
    { key: 'aiGeneratedPercent' as const, label: 'AI', color: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300' },
    { key: 'editedPercent' as const, label: 'Edited', color: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
    { key: 'screenshotPercent' as const, label: 'Screenshot', color: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300' },
    { key: 'tamperedPercent' as const, label: 'Tampered', color: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300' },
  ].filter((row) => (mix[row.key] ?? 0) > 0 || row.key === 'manualPercent');

  // Prefer model/forensic evidence; skip redundant hash/category clutter in compact view
  const evidenceItems = (analysis.evidence ?? []).filter((e) => {
    if (compact && (e.id === 'hash-sha256' || e.engine === 'cryptographic')) return false;
    return true;
  });

  const tamperScore = scores?.tamperScore ?? 0;
  const verdictKey = String(analysis.verdict ?? analysis.label ?? '').toUpperCase();
  const showHeatmap = Boolean(
    !compact
    && analysis.heatmapPngBase64
    && (tamperScore >= 15 || ['TAMPERED', 'EDITED', 'LIKELY_EDITED', 'SUSPICIOUS'].includes(verdictKey)),
  );

  return (
    <div className="rounded-xl border border-bg-border bg-bg-elevated p-3.5 space-y-3">
      <div className="flex items-center gap-2">
        <Microscope size={14} className="text-dna-400 shrink-0" />
        <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">{title}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-success/20 bg-success/5 p-2">
          <p className="text-2xs text-gray-500 uppercase tracking-wider">Content</p>
          <p className="text-xs font-semibold text-white mt-0.5">{verdict}</p>
        </div>
        <div className="rounded-lg border border-bg-border bg-bg-muted p-2">
          <p className="text-2xs text-gray-500 uppercase tracking-wider">Tamper</p>
          <p className="text-xs font-semibold text-white mt-0.5">
            {tamperScore < 15 ? `None · ${Math.round(tamperScore)}%` : `${Math.round(tamperScore)}%`}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={verdictBadgeVariant(String(analysis.verdict ?? analysis.label))}>
          {verdict}
        </Badge>
        <span className="text-2xs text-gray-600 dark:text-gray-300">
          {confidencePct}% confidence
          {scores?.confidenceLevel ? ` · ${scores.confidenceLevel}` : ''}
        </span>
      </div>

      {analysis.summary && (
        <p className="text-2xs text-gray-600 dark:text-gray-300 leading-relaxed">{analysis.summary}</p>
      )}

      {/* Single analysis panel — scores + one stacked mix bar (no duplicate graphs) */}
      <div className="rounded-lg bg-bg-muted border border-bg-border p-2.5 space-y-2.5">
        <div className="flex items-center gap-1.5">
          <Shield size={11} className="text-dna-400" />
          <p className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Analysis</p>
        </div>
        {scores && (
          <>
            <Meter label="Authenticity" value={scores.authenticityScore} color="bg-emerald-500" />
            <Meter label="Tamper" value={scores.tamperScore} color="bg-amber-500" />
            <Meter label="AI probability" value={scores.aiProbability} color="bg-rose-500" />
          </>
        )}
        <div className="pt-1">
          <p className="text-2xs text-gray-600 dark:text-gray-300 mb-1">Content mix</p>
          <div className="h-2.5 rounded-full bg-bg-card overflow-hidden flex">
            {mixSegments.map((row) => {
              const pct = Math.max(0, Math.min(100, mix[row.key] ?? 0));
              if (pct <= 0) return null;
              return (
                <div
                  key={row.key}
                  className={`h-full ${row.color}`}
                  style={{ width: `${pct}%` }}
                  title={`${row.label}: ${pct}%`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
            {mixSegments.map((row) => {
              const pct = mix[row.key] ?? 0;
              if (pct <= 0 && row.key !== 'manualPercent') return null;
              return (
                <span key={row.key} className={`text-2xs tabular-nums ${row.text}`}>
                  {row.label} {pct}%
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {!!evidenceItems.length && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle size={11} className="text-amber-400" />
            <p className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
              Evidence (why)
            </p>
          </div>
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {evidenceItems.slice(0, compact ? 5 : 10).map((e) => (
              <li key={e.id} className="text-2xs rounded-lg bg-bg-muted border border-bg-border p-2">
                <p className="text-gray-900 dark:text-gray-100 font-medium flex gap-1.5">
                  <ChevronRight size={10} className="mt-0.5 shrink-0 text-dna-500" />
                  <span>{e.title}</span>
                </p>
                <p className="text-gray-600 dark:text-gray-300 mt-0.5 pl-4 leading-snug">{e.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!evidenceItems.length && !!analysis.reasons?.length && (
        <div>
          <p className="text-2xs text-gray-600 dark:text-gray-300 mb-1">Findings</p>
          <ul className="space-y-1">
            {analysis.reasons.slice(0, 8).map((r) => (
              <li key={r} className="text-2xs text-gray-800 dark:text-gray-200 flex gap-1.5">
                <ChevronRight size={10} className="mt-0.5 shrink-0 text-dna-500" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && !!analysis.engines?.length && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles size={11} className="text-dna-400" />
            <p className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Checks run</p>
          </div>
          <ul className="space-y-1">
            {analysis.engines
              .filter((eng) => eng.status !== 'SKIPPED' && eng.status !== 'UNAVAILABLE')
              .map((eng) => (
              <li
                key={eng.id}
                className="flex items-start justify-between gap-2 text-2xs rounded-lg bg-bg-muted px-2 py-1.5"
              >
                <span className="text-gray-700 dark:text-gray-200 min-w-0">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{eng.name}</span>
                  <span className="block text-gray-600 dark:text-gray-300 truncate">{eng.summary}</span>
                </span>
                <Badge
                  variant={
                    eng.status === 'COMPLETE'
                      ? 'success'
                      : eng.status === 'FAILED'
                        ? 'danger'
                        : eng.status === 'PARTIAL'
                          ? 'warning'
                          : 'muted'
                  }
                >
                  {eng.status}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showHeatmap && (
        <div>
          <p className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-1.5">
            Tamper region map
          </p>
          <p className="text-2xs text-gray-500 mb-1.5">
            Warm blocks are where the scan found weaker texture — check those areas, they are not a proven edit.
          </p>
          <img
            src={`data:image/png;base64,${analysis.heatmapPngBase64}`}
            alt="Tamper region map"
            className="w-full rounded-lg border border-bg-border"
          />
        </div>
      )}
      {!compact && analysis.heatmapPngBase64 && !showHeatmap && (
        <p className="text-2xs text-gray-500">
          No tamper map shown — this protected file reads as original (tamper {Math.round(tamperScore)}%).
        </p>
      )}
    </div>
  );
}
