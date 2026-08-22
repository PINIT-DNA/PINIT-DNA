import React from 'react';
import { Info } from 'lucide-react';

/**
 * What to pay with while Razorpay is in test mode.
 *
 * This guidance used to live as a hardcoded paragraph inside the buyer
 * checkout only, so the seller's $25 activation screen showed nothing — a
 * creator reaching that page had no idea which card would work, and the
 * obvious choice fails.
 *
 * The failure is specific and worth stating rather than leaving to guesswork:
 * Razorpay classifies 4111 1111 1111 1111 as an INTERNATIONAL card, and this
 * account has international payments disabled. It is rejected for a reason
 * that has nothing to do with the card being a test card, so the error reads
 * like a card problem when it is really an account setting.
 *
 * Rendered only when the gateway is actually in test mode. There is no version
 * of this for live keys, and it never prefills anything — the card fields sit
 * in Razorpay's own cross-origin iframe, which no application can write into,
 * and which is the entire point of a hosted checkout.
 */
export default function TestPaymentHint({ billing, className = '' }) {
  if (!billing) return null;

  // Simulated payments take no card at all, so card guidance would confuse.
  if (billing.mock) {
    return (
      <p className={`pay-hint pay-hint--mock ${className}`}>
        <Info size={14} />
        <span>Test mode — payment is simulated and no card is charged.</span>
      </p>
    );
  }

  if (!billing.testMode) return null;

  return (
    <div className={`pay-hint ${className}`}>
      <Info size={14} />
      <div>
        <strong>Test mode — use a sandbox payment method.</strong>
        <ul>
          <li>
            UPI (easiest): <code>success@razorpay</code>
          </li>
          <li>
            Domestic card: <code>5267 3181 8797 5449</code>, any future expiry, any CVV
          </li>
        </ul>
        <em>
          Avoid 4111 1111 1111 1111 — Razorpay treats it as an international card
          and this account has international payments disabled.
        </em>
      </div>
    </div>
  );
}
