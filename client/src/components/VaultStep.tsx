import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { storeInVault } from '../services/api';
import { formatApiError } from '../services/dashboard.api';
import type { VaultStoreResponse } from '../types';

interface Props {
  file: File;
  dnaRecordId: string;
  custodyLocation?: { latitude: number; longitude: number } | null;
  /** Business Account — when protecting an asset from inside a Campaign workspace. */
  campaignId?: string | null;
  onComplete: (result: VaultStoreResponse) => void;
  onError: (msg: string) => void;
}

type VaultStage = 'working' | 'complete' | 'error';

export function VaultStep({ file, dnaRecordId, custodyLocation, campaignId, onComplete, onError }: Props) {
  const [stage, setStage] = useState<VaultStage>('working');

  /**
   * Vaulting is not idempotent — the API rejects a second store for the same
   * DNA record with "already in the vault".
   *
   * `custodyLocation` arrives asynchronously (App.tsx resolves GPS and calls
   * setCustodyLocation), so when it landed mid-upload the effect re-ran and
   * fired a second store for a record the first call had already vaulted. The
   * `cancelled` flag only suppressed the stale *state update*; the duplicate
   * network call still went out, and its rejection painted an error over a
   * protection that had in fact succeeded.
   *
   * Keyed by record id so protecting a genuinely different file still runs.
   */
  const submittedFor = useRef<string | null>(null);

  /** Read at call time so a location that resolved before the request still counts. */
  const locationRef = useRef(custodyLocation);
  locationRef.current = custodyLocation;

  useEffect(() => {
    if (submittedFor.current === dnaRecordId) return;
    submittedFor.current = dnaRecordId;

    let cancelled = false;

    const run = async () => {
      try {
        const location = locationRef.current;
        const result = await storeInVault(
          file,
          dnaRecordId,
          {
            ...(location
              ? { locationShared: true, latitude: location.latitude, longitude: location.longitude }
              : {}),
            ...(campaignId ? { campaignId } : {}),
          },
        );
        if (cancelled) return;
        setStage('complete');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onComplete(result as any);
      } catch (err: unknown) {
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyErr = err as any;
        if (anyErr?.isAssetQuotaExceeded) {
          onError(anyErr.message ?? 'Protected asset limit reached');
          return;
        }
        const msg = formatApiError(err);
        setStage('error');
        onError(msg);
      }
    };

    void run();
    return () => { cancelled = true; };
  }, [file, dnaRecordId, campaignId, onComplete, onError]);

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
        <div className="w-10 h-10 border-2 border-dna-400 border-t-transparent rounded-full animate-spin" />
      )}
    </motion.div>
  );
}
