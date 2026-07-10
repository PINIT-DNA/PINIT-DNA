import { motion } from 'framer-motion';
import { Check, Shield, Lock, Archive, Download, Loader2 } from 'lucide-react';
import { formatBytes } from '../lib/file-type-utils';

export type GenerationPhase = 'processing' | 'encrypting' | 'vaulting' | 'readying';

interface Props {
  phase: GenerationPhase;
  fileName?: string;
  fileSizeBytes?: number;
  mimeType?: string;
  dnaRecordId?: string;
}

const STEPS: Array<{
  id: GenerationPhase;
  label: string;
  title: string;
  detail: string;
  icon: typeof Shield;
}> = [
  {
    id: 'processing',
    label: 'Protect',
    title: 'Protecting your file',
    detail: 'Creating a unique identity for this file…',
    icon: Shield,
  },
  {
    id: 'encrypting',
    label: 'Secure',
    title: 'Securing your file',
    detail: 'Locking the file so only you can control it…',
    icon: Lock,
  },
  {
    id: 'vaulting',
    label: 'Store',
    title: 'Saving to your vault',
    detail: 'Storing your protected file safely…',
    icon: Archive,
  },
  {
    id: 'readying',
    label: 'Download',
    title: 'Preparing download',
    detail: 'Making a tracked copy ready when you need it…',
    icon: Download,
  },
];

function phaseIndex(phase: GenerationPhase): number {
  return STEPS.findIndex((s) => s.id === phase);
}

export function GenerationProgress({
  phase,
  fileName,
  fileSizeBytes,
  mimeType,
  dnaRecordId,
}: Props) {
  const current = phaseIndex(phase);
  const active = STEPS[current] ?? STEPS[0]!;
  const progressPct = Math.round(((current + 0.55) / STEPS.length) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto w-full px-4"
    >
      <div className="rounded-2xl border border-dna-500/25 bg-bg-card overflow-hidden shadow-lg">
        <div className="px-5 pt-6 pb-4 text-center border-b border-bg-border/60">
          <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-dna-500/10 border border-dna-500/25 flex items-center justify-center">
            <Loader2 size={26} className="text-dna-400 animate-spin" />
          </div>
          <h2 className="text-xl font-bold text-white">{active.title}</h2>
          <p className="text-sm text-gray-400 mt-1.5 leading-relaxed">{active.detail}</p>
        </div>

        {(fileName || dnaRecordId) && (
          <div className="px-5 py-3 bg-bg-elevated/50 border-b border-bg-border/40">
            {fileName && (
              <p className="text-sm text-white font-medium truncate text-center">{fileName}</p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-1">
              {fileSizeBytes != null && (
                <span className="text-2xs text-gray-500 mono">{formatBytes(fileSizeBytes)}</span>
              )}
              {mimeType && <span className="text-2xs text-gray-500 mono">{mimeType}</span>}
              {dnaRecordId && (
                <span className="text-2xs text-dna-400 mono">ID {dnaRecordId.slice(0, 8)}…</span>
              )}
            </div>
          </div>
        )}

        <div className="px-5 py-5 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xs text-gray-500 uppercase tracking-wider">Progress</span>
              <span className="text-2xs font-semibold text-dna-400 mono">{progressPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-bg-border overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-dna-500"
                initial={false}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
              />
            </div>
          </div>

          <ol className="space-y-2.5">
            {STEPS.map((step, i) => {
              const done = i < current;
              const activeStep = i === current;
              const Icon = step.icon;
              return (
                <li
                  key={step.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                    activeStep
                      ? 'border-dna-500/40 bg-dna-500/10'
                      : done
                        ? 'border-layer-complete/30 bg-layer-complete/5'
                        : 'border-bg-border bg-bg-elevated/40'
                  }`}
                >
                  <span
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      done
                        ? 'bg-layer-complete text-white'
                        : activeStep
                          ? 'bg-dna-500/20 text-dna-400'
                          : 'bg-bg-border text-gray-500'
                    }`}
                  >
                    {done ? <Check size={16} strokeWidth={2.5} /> : <Icon size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-semibold ${
                        activeStep ? 'text-white' : done ? 'text-layer-complete' : 'text-gray-500'
                      }`}
                    >
                      {step.label}
                    </p>
                    <p className="text-2xs text-gray-500 truncate">
                      {done ? 'Done' : activeStep ? 'Working…' : 'Next'}
                    </p>
                  </div>
                  {activeStep && (
                    <Loader2 size={14} className="text-dna-400 animate-spin shrink-0" />
                  )}
                </li>
              );
            })}
          </ol>

          <p className="text-center text-2xs text-gray-600">
            Please keep this page open. This usually takes a few seconds.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
