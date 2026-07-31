import type { PlanCode } from '../../hooks/useSubscription';

const SESSION_KEY = 'pinit_checkout_session';

export interface CheckoutSession {
  planCode: PlanCode;
  returnTo: string;
  feature?: string;
  featureLabel?: string;
  billingCycle: 'monthly';
  coupon?: string;
  paymentMethod?: string;
  simulateFailure?: boolean;
}

export function saveCheckoutSession(session: CheckoutSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* ignore */ }
}

export function loadCheckoutSession(): CheckoutSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CheckoutSession;
  } catch {
    return null;
  }
}

export function clearCheckoutSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

export function updateCheckoutSession(partial: Partial<CheckoutSession>): CheckoutSession | null {
  const current = loadCheckoutSession();
  if (!current) return null;
  const next = { ...current, ...partial };
  saveCheckoutSession(next);
  return next;
}
