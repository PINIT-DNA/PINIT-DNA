/**
 * Offline fallback defaults — must match backend config defaults.
 * Live limits always come from GET /subscription/me and /subscription/plans.
 */
export const SUBSCRIPTION_DEFAULTS = {
  freeAssetLimit: 5,
  businessFreeTeamLimit: 1,
  businessFreeWorkspaceLimit: 1,
  freeStorageBytes: 2 * 1024 * 1024 * 1024,
} as const;
