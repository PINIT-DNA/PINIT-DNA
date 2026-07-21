import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { withTimeout } from '../lib/promise-timeout';
import type { OrganizationIndustry } from '../lib/organization-profile';

export interface OrganizationView {
  id: string;
  shortId: string;
  name: string | null;
  industry: OrganizationIndustry | null;
  country: string | null;
  logoUrl: string | null;
  setupCompletedAt: string | null;
  setupSkippedAt: string | null;
  welcomeDismissedAt: string | null;
  showWelcome: boolean;
  defaultWorkspace: { id: string; name: string } | null;
}

let cache: OrganizationView | null = null;

export function useOrganization(enabled = true) {
  const [organization, setOrganization] = useState<OrganizationView | null>(cache);
  const [loading, setLoading] = useState(enabled && !cache);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    setLoading(true);
    setError(null);
    try {
      const org = await withTimeout(
        (async () => {
          const { data } = await api.get<{ organization?: OrganizationView }>(
            `${API_BASE_URL}/organization/me`,
          );
          return data.organization ?? null;
        })(),
        10_000,
        null,
      );      cache = org;
      setOrganization(org);
      return org;
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.error as string | undefined;
      setError(msg ?? 'Could not load organization');
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  async function skipWelcome() {
    const { data } = await api.post<{ organization?: OrganizationView }>(
      `${API_BASE_URL}/organization/welcome/skip`,
    );
    const org = data.organization ?? null;
    cache = org;
    setOrganization(org);
    return org;
  }

  async function completeSetup(payload: {
    organizationName: string;
    industry?: OrganizationIndustry;
    country?: string;
    workspaceName?: string;
    logoUrl?: string | null;
  }) {
    const { data } = await api.post<{ organization?: OrganizationView }>(
      `${API_BASE_URL}/organization/setup`,
      payload,
    );
    const org = data.organization ?? null;
    cache = org;
    setOrganization(org);
    return org;
  }

  return { organization, loading, error, refresh, skipWelcome, completeSetup };
}
