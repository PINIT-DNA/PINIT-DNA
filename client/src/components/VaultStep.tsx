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

type VaultStage = 'working' | 'complete' | 'error';

export function VaultStep({ file, dnaRecordId, onComplete, onError }: Props) {
  const [stage, setStage] = useState<VaultStage>('working');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      await delay(1100);
      if (cancelled) return;

      try {
        const result = await storeInVault(file, dnaRecordId);
        if (cancelled) return;
        setStage('complete');
        await delay(600);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!cancelled) onComplete(result as any);
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`card border-purple-500/30 bg-purple-500/5 py-8 px-6 text-center space-y-4 ${
        stage === 'error' ? 'border-red-500/30 bg-red-500/5' : ''
      }`}
    >
      {stage === 'complete' ? (
        <div className="w-12 h-12 mx-auto rounded-full bg-layer-complete flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      ) : stage === 'error' ? (
        <div className="text-3xl">⚠️</div>
      ) : (
        <div className="w-12 h-12 mx-auto border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
      )}
      <div>
        <p className="text-white font-semibold">
          {stage === 'complete' ? 'Saved to vault' : stage === 'error' ? 'Could not save' : 'Saving to vault'}
        </p>
        <p className="text-xs text-gray-500 mt-1 truncate max-w-[240px] mx-auto">{file.name}</p>
      </div>
      {error && (
        <p className="text-red-400 text-xs mono">{error}</p>
      )}
    </motion.div>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
