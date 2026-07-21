/**
 * Billing provider stubs — architecture only. No Stripe/Razorpay/PayPal calls.
 */

import type { BillingProviderAdapter, PlanCode } from '../types';

async function notImplemented(provider: string): Promise<never> {
  throw new Error(`${provider} billing is not implemented yet. Architecture stub only.`);
}

function stubAdapter(provider: BillingProviderAdapter['provider']): BillingProviderAdapter {
  return {
    provider,
    createCheckoutSession: async () => notImplemented(provider),
    handleWebhook: async () => notImplemented(provider),
  };
}

export const stripeBillingProvider = stubAdapter('STRIPE');
export const razorpayBillingProvider = stubAdapter('RAZORPAY');
export const paypalBillingProvider = stubAdapter('PAYPAL');

export function getBillingProvider(name: 'STRIPE' | 'RAZORPAY' | 'PAYPAL'): BillingProviderAdapter {
  switch (name) {
    case 'STRIPE':
      return stripeBillingProvider;
    case 'RAZORPAY':
      return razorpayBillingProvider;
    case 'PAYPAL':
      return paypalBillingProvider;
    default:
      return stripeBillingProvider;
  }
}

/** Placeholder for future checkout entry — intentionally unused. */
export type FutureCheckoutInput = {
  userId: string;
  planCode: PlanCode;
};
