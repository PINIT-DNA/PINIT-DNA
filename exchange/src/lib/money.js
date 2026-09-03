/**
 * Client-side money formatting — the storefront counterpart to
 * server/lib/money.js.
 *
 * Every price the customer sees must come through here, so the browse price,
 * the cart, the checkout and the receipt can never disagree about currency
 * again. The symbol is not hardcoded at call sites.
 */
const SYMBOLS = { USD: '$', INR: '₹' };
const DEFAULT_CURRENCY = 'INR';

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
  // Grouped thousands. A four-figure price rendered as ₹2500 or $2499 reads as
  // a reference number rather than money, and the larger licence tiers are all
  // four figures.
  const body = hasFraction
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.round(n).toLocaleString();
  return `${currencySymbol(code)}${body}`;
}

/**
 * Seller subscription, in major units.
 *
 * Kept beside the formatter so every screen that quotes the activation fee
 * reads the same number. It mirrors SELLER_SUBSCRIPTION_AMOUNT_PAISE on the
 * server (250000 paise = ₹2,500); the server remains the authority for what is
 * actually charged, this is only what is displayed before checkout opens.
 */
export const SELLER_SUBSCRIPTION_AMOUNT = 2500;
export const SELLER_SUBSCRIPTION_CURRENCY = 'INR';

/** "₹2,500" — the activation fee as shown to a creator. */
export function sellerSubscriptionLabel() {
  return formatMoney(SELLER_SUBSCRIPTION_AMOUNT, SELLER_SUBSCRIPTION_CURRENCY);
}

/** "From $49" style price teaser used on cards and detail pages. */
export function formatFrom(amount, code) {
  return `From ${formatMoney(amount, code)}`;
}
