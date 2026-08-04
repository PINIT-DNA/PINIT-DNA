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
    /* fall through to Free */
  }
  cached = FREE_FALLBACK;
  return FREE_FALLBACK;
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
      const view = await withTimeout(inflight, 8_000, cached ?? FREE_FALLBACK);
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
