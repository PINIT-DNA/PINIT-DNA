import { useEffect, useState } from 'react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { markBusinessSetupComplete } from '../lib/account-onboarding';

/** Sync business setup completion from the server (e.g. after login on a new device). */
export function useSyncBusinessSetup(userId: string | undefined, accountType?: string) {
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!userId || accountType !== 'BUSINESS') {
      setSynced(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const { data } = await api.get<{ complete?: boolean }>(
          `${API_BASE_URL}/auth/business-setup/status`,
        );
        if (cancelled) return;
        if (data.complete) {
          markBusinessSetupComplete(userId);
        }
      } catch {
        /* offline / dev */
      } finally {
        if (!cancelled) setSynced(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, accountType]);

  return synced;
}
