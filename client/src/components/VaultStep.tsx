import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { storeInVault } from '../services/api';
import { formatApiError, listVaultRecords } from '../services/dashboard.api';
import type { VaultRecord } from '../types/dashboard.types';
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

function vaultRecordToStoreResponse(row: VaultRecord): VaultStoreResponse {
  return {
    success: true,
    vaultId: row.id,
    dnaRecordId: row.dnaRecordId,
    originalFileName: row.originalFileName,
    originalMimeType: row.originalMimeType,
    encryptedSizeBytes: row.encryptedSizeBytes,
    originalSizeBytes: row.originalSizeBytes,
    encryptionAlgorithm: row.encryptionAlgorithm,
    storedAt: row.createdAt,
    contentLabel: row.contentLabel ?? null,
    contentAnalysis: row.contentAnalysis ?? null,
  };
}

export function VaultStep({ file, dnaRecordId, custodyLocation, campaignId, onComplete, onError }: Props) {
  const [stage, setStage] = useState<VaultStage>('working');

  /**
   * Share one in-flight POST per DNA id:
   * - React Strict Mode remounts this effect; swallowing success used to leave
   *   Generate spinning while My Assets already listed the file.
   * - `custodyLocation` arriving later must not start a second POST.
   */
  const inFlightByDna = useRef<Map<string, Promise<VaultStoreResponse>>>(new Map());
  const finishedRef = useRef(false);

  /** Read at call time so a location that resolved before the request still counts. */
  const locationRef = useRef(custodyLocation);
  locationRef.current = custodyLocation;

  useEffect(() => {
    let cancelled = false;
    finishedRef.current = false;

    const finish = (result: VaultStoreResponse) => {
      if (cancelled || finishedRef.current) return;
      finishedRef.current = true;
      setStage('complete');
      onComplete(result);
    };

    const fail = (msg: string, quota?: { message?: string }) => {
      if (cancelled || finishedRef.current) return;
      finishedRef.current = true;
      if (quota) {
        onError(quota.message ?? 'Protected asset limit reached');
        return;
      }
      setStage('error');
      onError(msg);
    };

    const findListed = async (): Promise<VaultStoreResponse | null> => {
      try {
        const rows = await listVaultRecords();
        const row = rows.find((v) => v.dnaRecordId === dnaRecordId);
        return row ? vaultRecordToStoreResponse(row) : null;
      } catch {
        return null;
      }
    };

    const runStore = async () => {
      let pending = inFlightByDna.current.get(dnaRecordId);
      if (!pending) {
        const location = locationRef.current;
        pending = storeInVault(
          file,
          dnaRecordId,
          {
            ...(location
              ? { locationShared: true, latitude: location.latitude, longitude: location.longitude }
              : {}),
            ...(campaignId ? { campaignId } : {}),
          },
        ) as Promise<VaultStoreResponse>;
        inFlightByDna.current.set(dnaRecordId, pending);
      }

      try {
        const result = await pending;
        finish(result);
      } catch (err: unknown) {
        inFlightByDna.current.delete(dnaRecordId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyErr = err as any;
        if (anyErr?.isAssetQuotaExceeded) {
          const listed = await findListed();
          if (listed) {
            finish(listed);
            return;
          }
          fail('', { message: anyErr.message ?? 'Protected asset limit reached' });
          return;
        }
        const status = anyErr?.response?.status as number | undefined;
        const listed = await findListed();
        if (listed && (status === 409 || status === 500 || !anyErr?.response)) {
          finish(listed);
          return;
        }
        fail(formatApiError(err));
      }
    };

    void runStore();

    // If the POST hangs after the backend already committed, My Assets is the
    // source of truth — complete as soon as this DNA appears in the vault list.
    const poll = window.setInterval(() => {
      if (cancelled || finishedRef.current) return;
      void findListed().then((listed) => {
        if (listed) finish(listed);
      });
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
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
