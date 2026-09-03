/**
 * Single source of truth for currency across Exchange.
 *
 * Every amount the storefront displays, the gateway charges, and the receipt
 * records must resolve through here. The previous split — a "$" storefront on
 * an INR gateway — meant a buyer was shown one currency and charged another.
 *
 * Listing prices are stored as whole display units (49, 149, 899, 2499). The
 * gateway wants the minor unit (cents for USD, paise for INR), which is always
 * the display amount x 100 for the currencies we support.
 */

/** Currencies Exchange can transact in. `minor` is the subunit multiplier. */
const CURRENCIES = {
  USD: { code: 'USD', symbol: '$', minor: 100, minimumMinor: 50 },
  INR: { code: 'INR', symbol: '₹', minor: 100, minimumMinor: 100 },
};

const DEFAULT_CURRENCY = 'INR';

/**
 * The currency Exchange sells in. Overridable per-environment so a future
 * multi-currency rollout is a config change, not a rewrite.
 */
export function activeCurrency() {
  const raw = String(process.env.PAYMENT_CURRENCY || DEFAULT_CURRENCY).trim().toUpperCase();
  // Indian Razorpay merchants cannot complete USD (no UPI; domestic cards refuse).
  // Seller activation is INR; license checkout must match unless explicitly allowed.
  if (raw === 'USD' && String(process.env.RAZORPAY_ALLOW_USD || '').trim() !== '1') {
    return DEFAULT_CURRENCY;
  }
  return CURRENCIES[raw] ? raw : DEFAULT_CURRENCY;
}

export function currencyMeta(code) {
  const key = String(code || activeCurrency()).trim().toUpperCase();
  return CURRENCIES[key] || CURRENCIES[DEFAULT_CURRENCY];
}

export function currencySymbol(code) {
  return currencyMeta(code).symbol;
}

/**
 * Convert a display amount to the gateway's minor unit, clamped to the
 * gateway minimum so a heavily discounted line cannot be rejected.
 */
export function toMinorUnits(amount, code) {
  const meta = currencyMeta(code);
  const n = Number(amount) || 0;
  return Math.max(meta.minimumMinor, Math.round(n * meta.minor));
}

/** Inverse of toMinorUnits — used when reading a gateway amount back. */
export function fromMinorUnits(minor, code) {
  const meta = currencyMeta(code);
  return Math.round((Number(minor) || 0)) / meta.minor;
}

/**
 * Format for display. Used by invoices and any server-rendered amount so the
 * server and the storefront can never disagree about the symbol.
 */
export function formatMoney(amount, code) {
  const meta = currencyMeta(code);
  const n = Number(amount) || 0;
  return `${meta.symbol}${n.toFixed(2)}`;
}

export { CURRENCIES, DEFAULT_CURRENCY };
