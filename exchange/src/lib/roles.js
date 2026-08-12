/** Frontend Exchange role helpers. Hub identity is independent of this role. */

export function exchangeRole(user) {
  if (!user) return null;
  const raw = String(user.exchange_role || user.role || '').toLowerCase();
  if (raw === 'admin') return 'admin';
  if (raw === 'creator' || raw === 'seller') return 'seller';
  if (raw === 'buyer') return 'buyer';
  return 'buyer';
}

export function isSeller(user) {
  const r = exchangeRole(user);
  return r === 'seller' || r === 'admin';
}

export function isBuyer(user) {
  const r = exchangeRole(user);
  return r === 'buyer' || r === 'admin';
}

export function canList(user) {
  return isSeller(user);
}

export function canPurchase(user) {
  if (!user) return false;
  return exchangeRole(user) === 'buyer' || exchangeRole(user) === 'admin';
}

export function roleLabel(user) {
  const r = exchangeRole(user);
  if (r === 'seller') return 'Creator';
  if (r === 'admin') return 'Admin';
  if (r === 'buyer') return 'Buyer';
  return 'Guest';
}

export function rolePositioning(user) {
  if (isSeller(user) && exchangeRole(user) !== 'admin') {
    return 'Create, protect, list and earn from creative assets.';
  }
  if (exchangeRole(user) === 'admin') return 'Platform administration for Pinit Exchange.';
  if (isBuyer(user)) return 'Discover, license and manage creative assets.';
  return 'Where protected creative assets are discovered, licensed and sold.';
}

export const HUB_POSITIONING = 'Your private workspace for the assets you own or manage.';
export const EXCHANGE_POSITIONING = 'Where protected creative assets are discovered, licensed and sold.';

export const SELLER_ONLY_PAGES = new Set(['creator_desk']);
export const BUYER_ONLY_PAGES = new Set(['cart']);
