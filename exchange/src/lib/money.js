/**
 * Client-side money formatting — the storefront counterpart to
 * server/lib/money.js.
 *
 * Every price the customer sees must come through here, so the browse price,
 * the cart, the checkout and the receipt can never disagree about currency
 * again. The symbol is not hardcoded at call sites.
 */
const SYMBOLS = { USD: '$', INR: '₹' };
const DEFAULT_CURRENCY = 'USD';

let platformCurrency = DEFAULT_CURRENCY;

/** Set once from GET /api/orders/billing/config so the client follows the server. */
export function setPlatformCurrency(code) {
  const key = String(code || '').trim().toUpperCase();
  if (SYMBOLS[key]) platformCurrency = key;
}

export function platformCurrencyCode() {
  return platformCurrency;
}

export function currencySymbol(code) {
  const key = String(code || platformCurrency).trim().toUpperCase();
  return SYMBOLS[key] || SYMBOLS[DEFAULT_CURRENCY];
}

/**
 * Format an amount. Pass the order's own currency for historical records —
 * an order charged in INR must keep rendering as INR even after the platform
 * currency changes, or the receipt becomes a lie.
 */
export function formatMoney(amount, code) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${currencySymbol(code)}0`;
  const hasFraction = Math.abs(n % 1) > 0.005;
  return `${currencySymbol(code)}${hasFraction ? n.toFixed(2) : String(Math.round(n))}`;
}

/** "From $49" style price teaser used on cards and detail pages. */
export function formatFrom(amount, code) {
  return `From ${formatMoney(amount, code)}`;
}
