import React from 'react';
import { Info, AlertTriangle } from 'lucide-react';

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

  /**
   * Demo mode must be unmistakable.
   *
   * A payment that succeeds without a gateway looks identical to one that
   * succeeded properly, so the only thing separating a demo from a real sale
   * is what the screen says. This is deliberately the loudest state here.
   */
  if (billing.demo) {
    return (
      <p className={`pay-hint pay-hint--demo ${className}`}>
        <AlertTriangle size={15} />
        <span>
          <strong>Demo payment — not a real transaction.</strong>
          No card is entered and no gateway is contacted. The order, licence and
          access below are created exactly as a paid one would be.
        </span>
      </p>
    );
  }

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

  /**
   * Sandbox credentials are a development aid, not product copy.
   *
   * Even on a test key, a deployed build is something customers and reviewers
   * look at, and printing card numbers on a payment screen there reads as
   * either a real instruction or a mistake. The panel is therefore limited to
   * local development builds; a deployed test-mode build shows the neutral
   * banner below instead, which states the fact without handing out
   * credentials to copy.
   */
  if (!import.meta.env.DEV) {
    return (
      <p className={`pay-hint pay-hint--mock ${className}`}>
        <Info size={14} />
        <span>Test mode — this is a sandbox payment and no live charge is made.</span>
      </p>
    );
  }

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
