import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Archive,
  Check,
  Download,
  FileImage,
  Loader2,
  Lock,
  Shield,
  Sparkles,
} from 'lucide-react';
import { formatBytes } from '../lib/file-type-utils';

export type GenerationPhase = 'processing' | 'encrypting' | 'vaulting' | 'readying';

interface Props {
  phase: GenerationPhase;
  fileName?: string;
  fileSizeBytes?: number;
  mimeType?: string;
  dnaRecordId?: string;
  /** Object URL for image preview when available */
  previewUrl?: string | null;
}

const PIPELINE = [
  { id: 'upload', label: 'Upload' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'generate', label: 'Generate DNA' },
  { id: 'secure', label: 'Secure & Store' },
  { id: 'ready', label: 'Ready' },
] as const;

const CHECKLIST = [
  { id: 'read', label: 'Reading file content' },
  { id: 'meta', label: 'Extracting metadata' },
  { id: 'fingerprint', label: 'Generating visual fingerprint' },
  { id: 'hash', label: 'Building DNA hash' },
  { id: 'vault', label: 'Encrypting & storing in vault' },
] as const;

function phaseToPipelineIndex(phase: GenerationPhase): number {
  switch (phase) {
    case 'processing': return 2; // Generate DNA active (upload+analyze done)
    case 'encrypting': return 3;
    case 'vaulting': return 3;
    case 'readying': return 4;
    default: return 2;
  }
}

function phaseToChecklistFloor(phase: GenerationPhase): number {
  switch (phase) {
    case 'processing': return 0;
    case 'encrypting': return 3;
    case 'vaulting': return 4;
    case 'readying': return 5;
    default: return 0;
  }
}

function DnaHelixMark({ spinning }: { spinning: boolean }) {
  return (
    <div className="relative w-28 h-28 mx-auto shrink-0">
      <motion.div
        className="absolute inset-0 rounded-full bg-gradient-to-br from-dna-500 via-indigo-500 to-cyan-400 opacity-90"
        animate={spinning ? { rotate: 360 } : { rotate: 0 }}
        transition={spinning ? { duration: 8, ease: 'linear', repeat: Infinity } : undefined}
      />
      <div className="absolute inset-[14px] rounded-full bg-bg-card border border-bg-border flex items-center justify-center shadow-inner">
        <Sparkles
          size={28}
          className={`text-dna-500 dark:text-dna-400 ${spinning ? 'animate-pulse' : ''}`}
        />
      </div>
      <div className="absolute -inset-1 rounded-full border border-dna-500/20 dark:border-dna-400/25 pointer-events-none" />
    </div>
  );
}

function ConfidenceGauge({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const r = 40;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  return (
    <div className="flex flex-col items-center">
      <div
        className="relative w-24 h-24"
        role="img"
        aria-label={`Pipeline confidence ${clamped} percent`}
      >
        <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90">
          <circle
            cx="48"
            cy="48"
            r={r}
            fill="none"
            strokeWidth="8"
            className="stroke-bg-border"
          />
          <circle
            cx="48"
            cy="48"
            r={r}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            className="stroke-dna-500"
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold mono text-dna-600 dark:text-dna-400">{clamped}%</span>
        </div>
      </div>
      <p className="text-2xs text-gray-500 mt-2 text-center">
        Stage completion — not a forensic verdict
      </p>
    </div>
  );
}

export function GenerationProgress({
  phase,
  fileName,
  fileSizeBytes,
  mimeType,
  dnaRecordId,
  previewUrl,
}: Props) {
  const pipelineIdx = phaseToPipelineIndex(phase);
  const checklistFloor = phaseToChecklistFloor(phase);
  const [subStep, setSubStep] = useState(checklistFloor);

  // Advance soft sub-steps within the active phase (UI-only; pipeline remains authoritative)
  useEffect(() => {
    setSubStep(checklistFloor);
    if (phase !== 'processing') return;

    const timers = [
      window.setTimeout(() => setSubStep(1), 450),
      window.setTimeout(() => setSubStep(2), 1100),
      window.setTimeout(() => setSubStep(3), 1900),
    ];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [phase, checklistFloor]);

  const effectiveSub = Math.max(subStep, checklistFloor);
  const completedChecks = Math.min(CHECKLIST.length, effectiveSub);
  const progressPct = useMemo(() => {
    const base = (pipelineIdx / PIPELINE.length) * 70;
    const sub = (completedChecks / CHECKLIST.length) * 30;
    return Math.min(98, Math.round(base + sub));
  }, [pipelineIdx, completedChecks]);

  const isImage = !!mimeType?.startsWith('image/') && !!previewUrl;
  const phaseLabel =
    phase === 'processing' ? 'Generating DNA…'
      : phase === 'encrypting' ? 'Securing your file…'
        : phase === 'vaulting' ? 'Saving to vault…'
          : 'Preparing download…';

  const maskedDna = dnaRecordId
    ? `${dnaRecordId.slice(0, 8)}${'•'.repeat(8)}`
    : '········••••••••';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-5xl mx-auto px-3 sm:px-4"
    >
      <div className="mb-4">
        <p className="text-2xs font-semibold uppercase tracking-wider text-dna-500 dark:text-dna-400">
          DNA Center
        </p>
        <h1 className="text-xl sm:text-2xl font-bold text-white mt-0.5">Generate DNA</h1>
        <p className="text-sm text-gray-500 mt-1">
          Creating a unique digital identity for your file — keep this page open.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_0.9fr] gap-4">
        {/* ── Main column ─────────────────────────────────────────────── */}
        <div className="space-y-4 min-w-0">
          {/* Asset card */}
          <div className="rounded-2xl border border-bg-border bg-bg-card p-4 flex gap-3 sm:gap-4 items-center">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-bg-border bg-bg-elevated shrink-0 flex items-center justify-center">
              {isImage ? (
                <img
                  src={previewUrl!}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <FileImage size={28} className="text-dna-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm sm:text-base font-semibold text-white truncate">
                {fileName ?? 'Untitled file'}
              </p>
              <p className="text-2xs sm:text-xs text-gray-500 mt-0.5 mono truncate">
                {[
                  fileSizeBytes != null ? formatBytes(fileSizeBytes) : null,
                  mimeType || null,
                ].filter(Boolean).join(' · ') || 'Preparing…'}
              </p>
              <span className="inline-flex items-center gap-1.5 mt-2 text-2xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-dna-500/10 text-dna-600 dark:text-dna-400 border border-dna-500/25">
                <Loader2 size={10} className="animate-spin" />
                Generating DNA
              </span>
            </div>
          </div>

          {/* Horizontal stepper */}
          <div className="rounded-2xl border border-bg-border bg-bg-card p-3 sm:p-4">
            <ol className="flex gap-2 overflow-x-auto pb-1">
              {PIPELINE.map((step, i) => {
                const done = i < pipelineIdx;
                const active = i === pipelineIdx;
                return (
                  <li
                    key={step.id}
                    className={`flex-1 min-w-[5.5rem] rounded-xl border px-2 py-2.5 text-center transition-colors ${
                      done
                        ? 'border-layer-complete/40 bg-layer-complete/10 text-layer-complete'
                        : active
                          ? 'border-dna-500/40 bg-dna-500/10 text-dna-600 dark:text-dna-400'
                          : 'border-bg-border bg-bg-elevated/50 text-gray-500'
                    }`}
                  >
                    <span className="block text-2xs opacity-70 mb-0.5">{i + 1}</span>
                    <span className="block text-2xs sm:text-xs font-bold leading-tight">{step.label}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Active generation panel */}
          <div className="rounded-2xl border border-bg-border bg-bg-card p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start">
              <DnaHelixMark spinning={phase !== 'readying'} />
              <div className="flex-1 w-full min-w-0">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-white">{phaseLabel}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Multi-layer fingerprint · encrypt · vault
                    </p>
                  </div>
                  <span
                    className="text-sm font-bold mono text-dna-600 dark:text-dna-400 shrink-0"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {progressPct}%
                  </span>
                </div>

                <div
                  className="h-2 rounded-full bg-bg-border overflow-hidden mb-4"
                  role="progressbar"
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-dna-500 to-indigo-500"
                    initial={false}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </div>

                <ul className="space-y-1.5">
                  {CHECKLIST.map((item, i) => {
                    const done = i < completedChecks;
                    const active = i === completedChecks && completedChecks < CHECKLIST.length;
                    return (
                      <li
                        key={item.id}
                        className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs sm:text-sm ${
                          active ? 'bg-dna-500/10' : ''
                        }`}
                      >
                        <span
                          className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                            done
                              ? 'bg-layer-complete text-white'
                              : active
                                ? 'bg-dna-500/20 text-dna-500 dark:text-dna-400'
                                : 'bg-bg-border text-gray-500'
                          }`}
                        >
                          {done ? (
                            <Check size={12} strokeWidth={2.5} />
                          ) : active ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                          )}
                        </span>
                        <span
                          className={
                            done
                              ? 'text-layer-complete font-medium'
                              : active
                                ? 'text-white font-semibold'
                                : 'text-gray-500'
                          }
                        >
                          {item.label}
                          {active && phase === 'processing' && i === 3 ? '…' : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <p className="text-center text-2xs text-gray-600 mt-4">
                  Please keep this page open. This usually takes a few seconds.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right rail ──────────────────────────────────────────────── */}
        <aside className="space-y-4 min-w-0">
          <div className="rounded-2xl border border-bg-border bg-bg-card p-4">
            <p className="text-2xs font-bold uppercase tracking-wider text-gray-500 mb-2">
              DNA Preview
            </p>
            <p className="mono text-sm text-dna-600 dark:text-dna-400 tracking-wide break-all">
              {maskedDna}
            </p>
            <dl className="mt-3 space-y-1.5 text-2xs">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Algorithm</dt>
                <dd className="text-white font-medium">PINIT DNA v2.0</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Hash</dt>
                <dd className="text-white font-medium mono">SHA-256</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Status</dt>
                <dd className="text-white font-medium capitalize">{phase}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-bg-border bg-bg-card p-4">
            <p className="text-2xs font-bold uppercase tracking-wider text-gray-500 mb-3 text-center">
              Pipeline confidence
            </p>
            <ConfidenceGauge percent={progressPct} />
          </div>

          <div className="rounded-2xl border border-bg-border bg-bg-card p-4">
            <p className="text-2xs font-bold uppercase tracking-wider text-gray-500 mb-3">
              What’s next
            </p>
            <ol className="space-y-2.5 text-xs text-gray-400">
              <li className="flex gap-2">
                <Archive size={14} className="text-dna-400 shrink-0 mt-0.5" />
                <span>Store encrypted original in Vault</span>
              </li>
              <li className="flex gap-2">
                <Shield size={14} className="text-dna-400 shrink-0 mt-0.5" />
                <span>Issue or link certificate</span>
              </li>
              <li className="flex gap-2">
                <Lock size={14} className="text-dna-400 shrink-0 mt-0.5" />
                <span>Share with Smart Link protection</span>
              </li>
              <li className="flex gap-2">
                <Download size={14} className="text-dna-400 shrink-0 mt-0.5" />
                <span>Download protected copy when ready</span>
              </li>
            </ol>
          </div>
        </aside>
      </div>
    </motion.div>
  );
}
