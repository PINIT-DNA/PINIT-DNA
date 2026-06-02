import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { storeInVault } from '../services/api';
import type { VaultStoreResponse } from '../types';

interface Props {
  file: File;
  dnaRecordId: string;
  onComplete: (result: VaultStoreResponse) => void;
  onError: (msg: string) => void;
}

type VaultStage = 'encrypting' | 'uploading' | 'storing' | 'complete' | 'error';

const STEPS: { key: VaultStage; label: string }[] = [
  { key: 'encrypting', label: 'Applying AES-256-GCM encryption...' },
  { key: 'uploading',  label: 'Sending encrypted payload to vault...' },
  { key: 'storing',    label: 'Persisting vault record to database...' },
  { key: 'complete',   label: 'Vault storage complete' },
];

export function VaultStep({ file, dnaRecordId, onComplete, onError }: Props) {
  const [stage, setStage] = useState<VaultStage>('encrypting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Show visual progression before actual API call
      await delay(600);
      if (cancelled) return;
      setStage('uploading');

      await delay(500);
      if (cancelled) return;
      setStage('storing');

      // Actual API call
      try {
        const result = await storeInVault(file, dnaRecordId);
        if (cancelled) return;
        setStage('complete');
        await delay(600);
        if (!cancelled) onComplete(result);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Vault storage failed';
        setStage('error');
        setError(msg);
        onError(msg);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [file, dnaRecordId, onComplete, onError]);

  const currentIdx = STEPS.findIndex((s) => s.key === stage);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`card border-purple-500/30 bg-purple-500/5 ${
        stage === 'error' ? 'border-red-500/30 bg-red-500/5' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="text-2xl">🏛️</div>
        <div>
          <p className="text-purple-400 mono text-xs font-medium">VAULT STORAGE</p>
          <p className="text-white font-semibold">Storing Encrypted Image</p>
        </div>
        {stage !== 'complete' && stage !== 'error' && (
          <div className="ml-auto w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
        )}
        {stage === 'complete' && (
          <div className="ml-auto w-7 h-7 rounded-full bg-layer-complete flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-2 mb-5">
        {STEPS.slice(0, -1).map((step, idx) => {
          const done   = idx < currentIdx;
          const active = idx === currentIdx && stage !== 'complete';
          return (
            <div key={step.key} className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all
                ${done   ? 'bg-layer-complete'              : ''}
                ${active ? 'border-2 border-purple-400'     : ''}
                ${!done && !active ? 'border-2 border-bg-border' : ''}
              `}>
                {done   && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                {active && <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />}
              </div>
              <span className={`text-sm ${done ? 'text-layer-complete' : active ? 'text-purple-300' : 'text-gray-600'}`}>
                {step.label}
              </span>
              {done   && <span className="ml-auto mono text-xs text-layer-complete">✓</span>}
              {active && <div className="ml-auto w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />}
            </div>
          );
        })}
      </div>

      {/* Vault details */}
      <div className="bg-bg-base rounded-lg p-4 space-y-2">
        {[
          { label: 'Algorithm',      value: 'AES-256-GCM'    },
          { label: 'Key Derivation', value: 'HKDF-SHA256'    },
          { label: 'IV Length',      value: '96 bits'        },
          { label: 'Auth Tag',       value: '128 bits'       },
          { label: 'Original Key',   value: 'Never stored'   },
          { label: 'File',           value: file.name        },
        ].map((row) => (
          <div key={row.label} className="flex justify-between">
            <span className="mono text-xs text-gray-500">{row.label}</span>
            <span className={`mono text-xs ${row.value === 'Never stored' ? 'text-layer-complete' : 'text-white'}`}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <p className="text-red-400 text-xs mono">{error}</p>
        </div>
      )}
    </motion.div>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
