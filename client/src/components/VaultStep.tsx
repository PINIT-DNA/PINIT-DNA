import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { storeInVault } from '../services/api';
import { formatApiError } from '../services/dashboard.api';
import type { VaultStoreResponse } from '../types';

interface Props {
  file: File;
  dnaRecordId: string;
  custodyLocation?: { latitude: number; longitude: number } | null;
  onComplete: (result: VaultStoreResponse) => void;
  onError: (msg: string) => void;
}

type VaultStage = 'working' | 'complete' | 'error';

export function VaultStep({ file, dnaRecordId, custodyLocation, onComplete, onError }: Props) {
  const [stage, setStage] = useState<VaultStage>('working');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      await delay(1100);
      if (cancelled) return;

      try {
        const result = await storeInVault(
          file,
          dnaRecordId,
          custodyLocation
            ? {
                locationShared: true,
                latitude: custodyLocation.latitude,
                longitude: custodyLocation.longitude,
              }
            : undefined,
        );
        if (cancelled) return;
        setStage('complete');
        await delay(600);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!cancelled) onComplete(result as any);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = formatApiError(err);
        setStage('error');
        onError(msg);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [file, dnaRecordId, custodyLocation, onComplete, onError]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="card py-8 px-6 flex items-center justify-center"
    >
      {stage === 'complete' ? (
        <div className="w-10 h-10 rounded-full bg-layer-complete flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      ) : stage === 'error' ? (
        <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 text-lg">!</div>
      ) : (
        <div className="w-10 h-10 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
      )}
    </motion.div>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
