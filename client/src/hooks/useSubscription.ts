import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import type { AccountType } from '../lib/account-type';
import { SUBSCRIPTION_DEFAULTS } from '../lib/subscription/defaults';
import { withTimeout } from '../lib/promise-timeout';

export type PlanCode = 'FREE' | 'PRO' | 'ENTERPRISE';

export const FeatureKey = {
  FEATURE_INVESTIGATION: 'FEATURE_INVESTIGATION',
  FEATURE_TRACKING: 'FEATURE_TRACKING',
  FEATURE_SMART_SHARE: 'FEATURE_SMART_SHARE',
  FEATURE_CHROME_EXTENSION: 'FEATURE_CHROME_EXTENSION',
  FEATURE_ADVANCED_REPORTS: 'FEATURE_ADVANCED_REPORTS',
} as const;

export type FeatureKey = (typeof FeatureKey)[keyof typeof FeatureKey];

export interface SubscriptionView {
  planCode: PlanCode;
  planName: string;
  status: string;
  features: string[];
  storageUsedBytes: number;
  storageLimitBytes: number | null;
  enforcementEnabled: boolean;
  accountType: AccountType;
  protectedAssetCount: number;
  assetLimit: number | null;
  assetsRemaining: number | null;
  teamMemberLimit: number | null;
  teamMemberCount: number;
  workspaceLimit: number | null;
}

const ALL_WORKFLOW_FEATURES = [
  'FEATURE_DNA',
  'FEATURE_VAULT',
  'FEATURE_CERTIFICATES',
  'FEATURE_DASHBOARD',
  'FEATURE_PROFILE',
  'FEATURE_INVESTIGATION',
  'FEATURE_TRACKING',
  'FEATURE_SMART_SHARE',
  'FEATURE_ADVANCED_REPORTS',
];

/** Offline fallback — mirrors backend defaults; API is source of truth. */
const FREE_FALLBACK: SubscriptionView = {
  planCode: 'FREE',
  planName: 'Free',
  status: 'ACTIVE',
  features: ALL_WORKFLOW_FEATURES,
  storageUsedBytes: 0,
  storageLimitBytes: SUBSCRIPTION_DEFAULTS.freeStorageBytes,
  enforcementEnabled: true,
  accountType: 'INDIVIDUAL',
  protectedAssetCount: 0,
  assetLimit: SUBSCRIPTION_DEFAULTS.freeAssetLimit,
  assetsRemaining: SUBSCRIPTION_DEFAULTS.freeAssetLimit,
  teamMemberLimit: null,
  teamMemberCount: 0,
  workspaceLimit: null,
};

let cached: SubscriptionView | null = null;
let inflight: Promise<SubscriptionView> | null = null;
let lastFetchedAt = 0;
const STALE_MS = 60_000;

/**
 * A failed request is not evidence of a Free plan.
 *
 * This used to answer a network error by writing FREE_FALLBACK into `cached`,
 * which is module-level and shared: one slow response and every component read
 * "Free" for the rest of the session. A Pro account showed "Free plan" and
 * "0 of 5 protected assets used" while its five files were listed on the same
 * screen — seen in production, where the free-tier backend cold-starts around
 * 50s and blows past the timeout below.
 *
 * Absence of an answer now leaves the last known plan in place, and never
 * writes a fabricated one into the cache. FREE_FALLBACK stays as the first-load
 * default only, where nothing better exists yet.
 */
async function fetchSubscription(): Promise<SubscriptionView> {
  try {
    const { data } = await api.get<{ success?: boolean; subscription?: SubscriptionView }>(
      `${API_BASE_URL}/subscription/me`,
    );
    if (data?.success && data.subscription) {
      cached = data.subscription as SubscriptionView;
      lastFetchedAt = Date.now();
      return cached;
    }
  } catch {
    /* keep whatever we already knew — see above */
  }
  // Deliberately NOT assigned to `cached`: a failure must not become a fact.
  return cached ?? FREE_FALLBACK;
}

export function invalidateSubscriptionCache(): void {
  cached = null;
  inflight = null;
  lastFetchedAt = 0;
}

export function useSubscription() {
  const [subscription, setSubscription] = useState<SubscriptionView | null>(cached);
  const [loading, setLoading] = useState(!cached);

  const refresh = useCallback(async () => {
    const silent = Boolean(cached);
    if (!silent) setLoading(true);
    try {
      if (!inflight) inflight = fetchSubscription().finally(() => { inflight = null; });
      // 8s could not survive a cold start on Render's free tier, which takes
      // ~50s to wake — so the very first load of the day always fell back.
      // The fallback is now the last known plan rather than a guess, but the
      // wait still needs to outlast the wake-up or it is never reached.
      const view = await withTimeout(inflight, 60_000, cached ?? FREE_FALLBACK);
      setSubscription(view);
      return view;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stale = !cached || Date.now() - lastFetchedAt > STALE_MS;
    if (stale) void refresh();
    else if (cached) setSubscription(cached);
  }, [refresh]);

  const hasFeature = useCallback(
    (feature: string) => {
      const view = subscription ?? (loading ? null : FREE_FALLBACK);
      if (!view) return false;
      if (!view.enforcementEnabled) return true;
      return view.features.includes(feature);
    },
    [subscription, loading],
  );

  /** Features are not gated on Free — only asset quota limits protect actions. */
  const isLocked = useCallback((_feature: string) => false, []);

  const isQuotaExhausted = useCallback(() => {
    const view = subscription ?? FREE_FALLBACK;
    if (view.assetLimit == null) return false;
    return (view.assetsRemaining ?? 0) <= 0;
  }, [subscription]);

  const view = subscription ?? (loading ? null : FREE_FALLBACK);

  return {
    subscription: view,
    loading,
    refresh,
    hasFeature,
    isLocked,
    isQuotaExhausted,
    planCode: (view ?? FREE_FALLBACK).planCode,
    accountType: (view ?? FREE_FALLBACK).accountType,
  };
}
