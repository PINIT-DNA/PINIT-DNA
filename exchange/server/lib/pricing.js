import db from '../database.js';
import { toMinorUnits, activeCurrency } from './money.js';

export function tierPrice(listing, licenseTier) {
  if (licenseTier === 'commercial') return Number(listing.price_commercial) || 149;
  if (licenseTier === 'exclusive') return Number(listing.price_exclusive) || 899;
  if (licenseTier === 'enterprise') return Number(listing.price_enterprise) || 2499;
  return Number(listing.price_personal) || 49;
}

/**
 * Listing display amounts -> the gateway's minor unit for the active currency.
 * Kept under the old name so existing call sites are unchanged; the INR
 * assumption it used to encode now lives in lib/money.js.
 */
export function toPaise(amount, currency) {
  return toMinorUnits(amount, currency || activeCurrency());
}

export function applyCouponPercent(price, percent) {
  const p = Number(percent) || 0;
  if (p <= 0) return Number(price);
  return Math.round(Number(price) * (1 - p / 100) * 100) / 100;
}

export function resolveCouponPercent(code, sellerPinitId) {
  return new Promise((resolve) => {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return resolve(0);
    db.get('SELECT * FROM coupons WHERE code = ? AND active = 1', [c], (err, coupon) => {
      if (err || !coupon) return resolve(0);
      if (coupon.seller_pinit_id && sellerPinitId && coupon.seller_pinit_id !== sellerPinitId) {
        return resolve(0);
      }
      resolve(Number(coupon.percent_off) || 0);
    });
  });
}

export function getListing(listingId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT l.*, COALESCE(u.exchange_id, 'PX-772091') as seller_exchange_id
       FROM listings l
       LEFT JOIN users u ON l.pinit_id = u.pinit_id
       WHERE l.listing_id = ?`,
      [listingId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      },
    );
  });
}
