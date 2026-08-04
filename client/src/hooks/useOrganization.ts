import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import type { OrganizationIndustry, OrganizationSize } from '../lib/organization-profile';

export interface OrganizationView {
  id: string;
  shortId: string;
  name: string | null;
  industry: OrganizationIndustry | null;
  organizationSize: OrganizationSize | null;
  businessType: string | null;
  country: string | null;
  website: string | null;
  registrationNumber: string | null;
  gst: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  foundedYear: number | null;
  linkedIn: string | null;
  aboutDescription: string | null;
  services: string | null;
  notes: string | null;
  logoUrl: string | null;
  setupCompletedAt: string | null;
  setupSkippedAt: string | null;
  welcomeDismissedAt: string | null;
  showWelcome: boolean;
  defaultWorkspace: { id: string; shortId: string | null; name: string } | null;
}

export type OrganizationProfilePayload = Partial<{
  organizationName: string;
  industry: OrganizationIndustry;
  organizationSize: OrganizationSize;
  businessType: string;
  country: string;
  website: string;
  registrationNumber: string;
  gst: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  supportEmail: string;
  supportPhone: string;
  foundedYear: number | string;
  linkedIn: string;
  aboutDescription: string;
  services: string;
  notes: string;
  workspaceName: string;
  logoUrl: string | null;
}>;

let cache: OrganizationView | null = null;

function setCache(org: OrganizationView | null) {
  cache = org;
}

export function useOrganization(enabled = true) {
  const [organization, setOrganization] = useState<OrganizationView | null>(cache);
  const [loading, setLoading] = useState(enabled && !cache);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    const silent = Boolean(cache);
    if (!silent) setLoading(true);
    setError(null);
    try {
      let org: OrganizationView | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { data } = await api.get<{ organization?: OrganizationView }>(
            `${API_BASE_URL}/organization/me`,
          );
          org = data.organization ?? null;
          if (org?.shortId) break;
        } catch (err: unknown) {
          if (attempt === 1) throw err;
        }
        if (!org?.shortId) {
          const { data } = await api.post<{ organization?: OrganizationView }>(
            `${API_BASE_URL}/organization/welcome/skip`,
          );
          org = data.organization ?? null;
        }
      }
      setCache(org);
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
    setCache(org);
    setOrganization(org);
    return org;
  }

  async function completeSetup(payload: OrganizationProfilePayload & { organizationName: string }) {
    const { data } = await api.post<{ organization?: OrganizationView }>(
      `${API_BASE_URL}/organization/setup`,
      payload,
    );
    const org = data.organization ?? null;
    setCache(org);
    setOrganization(org);
    return org;
  }

  async function updateProfile(payload: OrganizationProfilePayload) {
    const { data } = await api.patch<{ organization?: OrganizationView }>(
      `${API_BASE_URL}/organization/profile`,
      payload,
    );
    const org = data.organization ?? null;
    setCache(org);
    setOrganization(org);
    return org;
  }

  async function uploadLogo(file: File) {
    const form = new FormData();
    form.append('logo', file);
    const { data } = await api.post<{ organization?: OrganizationView }>(
      `${API_BASE_URL}/organization/logo`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    const org = data.organization ?? null;
    setCache(org);
    setOrganization(org);
    return org;
  }

  return { organization, loading, error, refresh, skipWelcome, completeSetup, updateProfile, uploadLogo };
}

export function invalidateOrganizationCache() {
  cache = null;
}
