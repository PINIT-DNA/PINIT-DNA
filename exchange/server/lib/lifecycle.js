/** Listing / order / license lifecycle constants (Exchange commerce only). */

export const LISTING_STATUS = {
  DRAFT: 'draft',
  PROTECTION_PENDING: 'protection_pending',
  PROTECTION_FAILED: 'protection_failed',
  PUBLISHED: 'published',
  UNLISTED: 'unlisted',
  SUSPENDED: 'suspended',
  REVOKED: 'revoked',
  ARCHIVED: 'archived',
  SOLD_EXCLUSIVE: 'sold_exclusive',
  /** Legacy alias still accepted as purchasable */
  LIVE: 'live',
};

export const ORDER_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  SEALED: 'sealed', // legacy paid+sealed
  FAILED: 'failed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
};

export const LICENSE_STATUS = {
  ACTIVE: 'active',
  REVOKED: 'revoked',
  REFUNDED: 'refunded',
  EXPIRED: 'expired',
};

export const BRIDGE_EVENT = {
  LISTED: 'LISTED',
  SOLD: 'SOLD',
  DELIVERED: 'DELIVERED',
  UNLISTED: 'UNLISTED',
  PROTECTION_FAILED: 'PROTECTION_FAILED',
  REFUND: 'REFUND',
};

const PURCHASABLE = new Set([LISTING_STATUS.PUBLISHED, LISTING_STATUS.LIVE]);

export function normalizeListingStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'live') return LISTING_STATUS.PUBLISHED;
  return s || LISTING_STATUS.DRAFT;
}

export function isListingPurchasable(status) {
  return PURCHASABLE.has(String(status || '').toLowerCase());
}

export function publicListingSql() {
  return `(l.status = 'published' OR l.status = 'live')`;
}

/**
 * Marketplace must not show listings whose Exchange seller account is gone.
 * A user delete that only removed the users row used to leave published
 * orphans on Discover with broken Hub previews ("Preview unavailable").
 */
export function publicListingWithSellerSql() {
  return `${publicListingSql()} AND u.pinit_id IS NOT NULL`;
}

export function isLicenseDownloadable(licenseStatus) {
  return String(licenseStatus || LICENSE_STATUS.ACTIVE).toLowerCase() === LICENSE_STATUS.ACTIVE;
}
