import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { EncryptionResult } from '../types';

interface Props {
  dnaRecordId: string;
  onComplete: (result: EncryptionResult) => void;
}

type EncStage = 'generating-key' | 'encrypting' | 'finalizing' | 'complete';

const STAGES: { key: EncStage; label: string; ms: number }[] = [
  { key: 'generating-key', label: 'Generating AES-256 key...', ms: 900 },
  { key: 'encrypting',     label: 'Encrypting DNA record...', ms: 1200 },
  { key: 'finalizing',     label: 'Finalizing GCM auth tag...', ms: 600 },
  { key: 'complete',       label: 'Encryption complete',       ms: 0 },
];


export function EncryptionStep({ dnaRecordId, onComplete }: Props) {
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    let i = 0;
    const advance = () => {
      if (i >= STAGES.length - 1) {
        // Done — build result
        const result: EncryptionResult = {
          algorithm: 'AES-256-GCM',
          keyLength: 256,
          encryptedAt: new Date().toISOString(),
        };
        onComplete(result);
        return;
      }
      i++;
      setStageIdx(i);
      setTimeout(advance, STAGES[i].ms);
    };
    setTimeout(advance, STAGES[0].ms);
  }, [onComplete]);

  const currentStage = STAGES[stageIdx];
  const isDone = currentStage.key === 'complete';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="card border-yellow-500/30 bg-yellow-500/5"
    >
      <div className="flex items-center gap-3 mb-5">
        <div className="text-2xl">🔒</div>
        <div>
          <p className="text-yellow-400 mono text-xs font-medium">AES-256-GCM ENCRYPTION</p>
          <p className="text-white font-semibold">Encrypting DNA Record</p>
        </div>
      </div>

      {/* Progress steps */}
      <div className="space-y-2 mb-5">
        {STAGES.slice(0, -1).map((stage, idx) => {
          const done = idx < stageIdx;
          const active = idx === stageIdx && !isDone;

          return (
            <div key={stage.key} className="flex items-center gap-3">
              <div
                className={`
                  w-5 h-5 rounded-full flex items-center justify-center shrink-0
                  transition-all duration-300
                  ${done
                    ? 'bg-layer-complete'
                    : active
                    ? 'border-2 border-yellow-400'
                    : 'border-2 border-bg-border'
                  }
                `}
              >
                {done ? (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : active ? (
                  <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                ) : null}
              </div>
              <span
                className={`text-sm ${done ? 'text-layer-complete' : active ? 'text-yellow-300' : 'text-gray-600'}`}
              >
                {stage.label}
              </span>
              {active && (
                <div className="ml-auto w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
              )}
              {done && (
                <span className="ml-auto mono text-xs text-layer-complete">✓</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Encryption details */}
      <div className="bg-bg-base rounded-lg p-4 space-y-2">
        <div className="flex justify-between">
          <span className="mono text-xs text-gray-500">Algorithm</span>
          <span className="mono text-xs text-yellow-400">AES-256-GCM</span>
        </div>
        <div className="flex justify-between">
          <span className="mono text-xs text-gray-500">Key Length</span>
          <span className="mono text-xs text-white">256 bits</span>
        </div>
        <div className="flex justify-between">
          <span className="mono text-xs text-gray-500">IV Length</span>
          <span className="mono text-xs text-white">96 bits (12 bytes)</span>
        </div>
        <div className="flex justify-between">
          <span className="mono text-xs text-gray-500">Auth Tag</span>
          <span className="mono text-xs text-white">128 bits</span>
        </div>
        <div className="flex justify-between">
          <span className="mono text-xs text-gray-500">DNA Record</span>
          <span className="mono text-xs text-dna-400 truncate ml-4 max-w-[180px]">
            {dnaRecordId.substring(0, 20)}...
          </span>
        </div>
      </div>
    </motion.div>
  );
}
