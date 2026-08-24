/**
 * Licence entitlements and terms versioning.
 *
 * Download allowances were previously undefined, so every tier behaved as
 * unlimited and tier pricing had nothing behind it. These are the entitlements
 * the storefront advertises; enforcement lives in the download-authorise route.
 */

/** Downloads permitted per sealed licence. null = unlimited. */
const DOWNLOAD_LIMITS = {
  personal: 5,
  commercial: 25,
  exclusive: null,
  enterprise: null,
};

/**
 * Version of the licence terms a buyer accepts at checkout. Bump this whenever
 * the terms text changes so historical orders keep pointing at the wording the
 * buyer actually agreed to.
 */
export const LICENSE_TERMS_VERSION = 'v1.0';

export function downloadLimitForTier(tier) {
  const key = String(tier || 'personal').toLowerCase();
  return Object.prototype.hasOwnProperty.call(DOWNLOAD_LIMITS, key)
    ? DOWNLOAD_LIMITS[key]
    : DOWNLOAD_LIMITS.personal;
}

export function isUnlimited(limit) {
  return limit === null || limit === undefined;
}

/**
 * Remaining downloads for an order row. Returns null when unlimited so callers
 * can distinguish "no limit" from "none left".
 */
export function downloadsRemaining(order) {
  const limit = order?.download_limit;
  if (isUnlimited(limit)) return null;
  const used = Number(order?.download_count || 0);
  return Math.max(0, Number(limit) - used);
}

export function downloadQuotaExhausted(order) {
  const remaining = downloadsRemaining(order);
  return remaining !== null && remaining <= 0;
}

/** Human-readable entitlement, used on licence cards and invoices. */
export function describeEntitlement(tier) {
  const limit = downloadLimitForTier(tier);
  return isUnlimited(limit) ? 'Unlimited downloads' : `${limit} downloads`;
}

export { DOWNLOAD_LIMITS };
