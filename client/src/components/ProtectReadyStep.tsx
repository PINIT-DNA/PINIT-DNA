import { useEffect, useState } from 'react';
import { protectedDownloadFromVault } from '../services/dashboard.api';

export interface ProtectReadyResult {
  tepCode?: string;
  blob: Blob;
  filename?: string;
}

interface Props {
  vaultId: string;
  onComplete: (result: ProtectReadyResult) => void;
  onError: () => void;
}

/**
 * After vault store: create tracked protected copy (watermark + identity + tracking).
 * Registers export in DB so investigation can recover the file later.
 */
export function ProtectReadyStep({ vaultId, onComplete, onError }: Props) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const { blob, tepCode } = await protectedDownloadFromVault(vaultId, {
          recipientLabel: 'owner-generate',
          purpose: 'generate-flow',
        });
        if (cancelled) return;
        setDone(true);
        onComplete({ blob, tepCode });
      } catch {
        if (!cancelled) onError();
      }
    };

    void run();
    return () => { cancelled = true; };
  }, [vaultId, onComplete, onError]);

  return <span className="sr-only">{done ? 'ready' : 'preparing'}</span>;
}
