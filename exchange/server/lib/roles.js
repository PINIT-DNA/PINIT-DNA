/**
 * Exchange marketplace roles. Hub identity is independent.
 * DB stores seller as `creator` (legacy); public API exposes exchange_role.
 */

export const EXCHANGE_ROLES = {
  BUYER: 'buyer',
  SELLER: 'seller',
  ADMIN: 'admin',
};

export function normalizeRole(role) {
  const r = String(role || '').toLowerCase().trim();
  if (r === 'admin') return EXCHANGE_ROLES.ADMIN;
  if (r === 'creator' || r === 'seller') return EXCHANGE_ROLES.SELLER;
  return EXCHANGE_ROLES.BUYER;
}

export function isAdminRole(role) {
  return normalizeRole(role) === EXCHANGE_ROLES.ADMIN;
}

export function isSellerRole(role) {
  const n = normalizeRole(role);
  return n === EXCHANGE_ROLES.SELLER || n === EXCHANGE_ROLES.ADMIN;
}

export function isBuyerRole(role) {
  const n = normalizeRole(role);
  return n === EXCHANGE_ROLES.BUYER || n === EXCHANGE_ROLES.ADMIN;
}

export function canList(role) {
  return isSellerRole(role);
}

export function canPurchase(role) {
  return normalizeRole(role) === EXCHANGE_ROLES.BUYER || isAdminRole(role);
}

export function buyerDeniedList() {
  return {
    error: 'BUYER_CANNOT_LIST',
    message: 'Buyer accounts cannot list assets on Pinit Exchange. Become a Creator to sell.',
  };
}

export function sellerDeniedPurchase() {
  return {
    error: 'SELLER_CANNOT_PURCHASE',
    message: 'Creator accounts cannot purchase marketplace assets.',
  };
}

export function sellerDeniedBuyerAction() {
  return {
    error: 'SELLER_CANNOT_BUY',
    message: 'Creator accounts cannot post buyer requirements or check out as a buyer.',
  };
}

export function buyerDeniedSellerAction() {
  return {
    error: 'BUYER_CANNOT_SELL',
    message: 'Buyer accounts cannot access seller tools. Become a Creator to list and manage sales.',
  };
}

export function rolePositioning(role) {
  const n = normalizeRole(role);
  if (n === EXCHANGE_ROLES.SELLER) {
    return 'Create, protect, list and earn from creative assets.';
  }
  if (n === EXCHANGE_ROLES.ADMIN) {
    return 'Platform administration for Pinit Exchange.';
  }
  return 'Discover, license and manage creative assets.';
}

export function enrichPublicUser(row) {
  if (!row) return null;
  const { password_hash: _pw, ...safe } = row;
  const exchange_role = normalizeRole(row.role);
  return {
    ...safe,
    exchange_role,
    can_list: canList(row.role),
    can_purchase: canPurchase(row.role),
    positioning: rolePositioning(row.role),
  };
}
