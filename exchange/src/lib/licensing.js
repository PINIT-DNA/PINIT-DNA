/**
 * Storefront mirror of server/lib/licensing.js.
 *
 * The buyer must be told exactly what the download-authorise route will
 * enforce, so these limits are copied from the server module rather than
 * described loosely in page copy. If the server limits change, change them
 * here in the same commit — a storefront that advertises more than the
 * backend grants is a support ticket at best.
 */

/** Downloads permitted per sealed licence. null = unlimited. */
export const DOWNLOAD_LIMITS = {
  personal: 5,
  commercial: 25,
  exclusive: null,
  enterprise: null,
};

/** Display order of the tiers, cheapest first. */
export const TIER_ORDER = ['personal', 'commercial', 'exclusive', 'enterprise'];

export const TIER_LABELS = {
  personal: 'Personal',
  commercial: 'Commercial',
  exclusive: 'Exclusive',
  enterprise: 'Enterprise',
};

export const TIER_SUMMARIES = {
  personal: 'Single user, non-commercial portfolio and education use.',
  commercial: 'Client deliverables, campaigns and digital advertising.',
  exclusive: 'Exclusive rights — the asset is delisted from Exchange on sale.',
  enterprise: 'Multi-seat organisation licence with protected delivery.',
};

/**
 * What each tier does and does not permit. Written as plain entitlements so
 * the licence tab states rights rather than marketing them.
 */
export const TIER_RIGHTS = {
  personal: {
    allowed: ['Personal projects', 'Portfolio and coursework', 'Non-monetised social posts'],
    excluded: ['Client work', 'Paid advertising', 'Resale or redistribution'],
  },
  commercial: {
    allowed: ['Client deliverables', 'Paid campaigns and advertising', 'Websites, apps and packaging'],
    excluded: ['Resale of the asset itself', 'Use in a competing stock library', 'Sub-licensing to third parties'],
  },
  exclusive: {
    allowed: ['All commercial use', 'Sole rights — the asset leaves the marketplace', 'Unlimited seats within your organisation'],
    excluded: ['Resale of the asset itself', 'Transfer of authorship or provenance'],
  },
  enterprise: {
    allowed: ['All commercial use', 'Multi-seat and multi-brand deployment', 'Protected delivery to your team'],
    excluded: ['Resale of the asset itself', 'Use in a competing stock library'],
  },
};

export function isUnlimited(limit) {
  return limit === null || limit === undefined;
}

export function downloadLimitForTier(tier) {
  const key = String(tier || 'personal').toLowerCase();
  return Object.prototype.hasOwnProperty.call(DOWNLOAD_LIMITS, key)
    ? DOWNLOAD_LIMITS[key]
    : DOWNLOAD_LIMITS.personal;
}

/** Human-readable entitlement, matching the wording used on licence cards. */
export function describeEntitlement(tier) {
  const limit = downloadLimitForTier(tier);
  return isUnlimited(limit) ? 'Unlimited downloads' : `${limit} downloads`;
}

/**
 * Tiers this listing is actually sold under.
 *
 * A tier with no price set by the creator is NOT offered. The previous detail
 * page fell back to invented figures (49 / 149 / 899 / 2499), which showed the
 * buyer a price the creator never agreed to and let them start a checkout for
 * a tier that was never on sale.
 */
export function availableTiers(listing) {
  if (!listing) return [];
  return TIER_ORDER
    .map((id) => ({ id, price: Number(listing[`price_${id}`]) }))
    .filter((t) => Number.isFinite(t.price) && t.price > 0)
    .map((t) => ({
      ...t,
      name: TIER_LABELS[t.id],
      summary: TIER_SUMMARIES[t.id],
      rights: TIER_RIGHTS[t.id],
      entitlement: describeEntitlement(t.id),
    }));
}
