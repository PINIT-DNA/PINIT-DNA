import type { PlanCode } from '../../hooks/useSubscription';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { openRazorpayCheckout } from './razorpay-checkout';

export interface PaymentCompleteParams {
  planCode: PlanCode;
  paymentMethod: string;
  coupon?: string;
  simulateFailure?: boolean;
  userName?: string;
  userEmail?: string;
  onCheckoutOpen?: () => void;
  onVerifying?: () => void;
}

export interface PaymentCompleteResult {
  transactionId: string;
  planCode: PlanCode;
  planName: string;
  amountInr: number;
  currentPeriodEnd: string;
}

export interface PaymentProvider {
  readonly id: 'mock' | 'razorpay' | 'stripe';
  completePayment(params: PaymentCompleteParams): Promise<PaymentCompleteResult>;
}

export interface BillingConfig {
  configured: boolean;
  keyId: string | null;
  currency: string;
  /** Dev/test-only simulated checkout — server refuses it outside development, this just drives the UI. */
  mockAllowed: boolean;
}

let cachedProviderId: 'mock' | 'razorpay' | null = null;
let billingConfigCache: BillingConfig | null = null;

/** Mock provider — used when Razorpay keys are not configured (local dev). */
export const mockPaymentProvider: PaymentProvider = {
  id: 'mock',
  async completePayment(params) {
    if (params.simulateFailure) {
      await delay(2200);
      throw new Error('Payment declined by bank. Please try another method.');
    }

    const { data } = await api.post<{
      success?: boolean;
      payment?: PaymentCompleteResult;
    }>(`${API_BASE_URL}/subscription/billing/mock-complete`, {
      planCode: params.planCode,
      paymentMethod: params.paymentMethod,
      coupon: params.coupon,
    });

    if (!data?.payment?.transactionId) {
      throw new Error('Payment could not be completed');
    }
    return data.payment;
  },
};

export const razorpayPaymentProvider: PaymentProvider = {
  id: 'razorpay',
  async completePayment(params) {
    const { data: orderData } = await api.post<{
      success?: boolean;
      order?: {
        orderId: string;
        amount: number;
        currency: string;
        keyId: string;
        planCode: PlanCode;
        planName: string;
        priceInr: number;
      };
    }>(`${API_BASE_URL}/subscription/billing/create-order`, {
      planCode: params.planCode,
    });

    const order = orderData?.order;
    if (!order?.orderId || !order.keyId) {
      throw new Error('Could not create payment order');
    }

    params.onCheckoutOpen?.();

    const paymentResponse = await openRazorpayCheckout({
      keyId: order.keyId,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      planName: order.planName,
      userName: params.userName,
      userEmail: params.userEmail,
    });

    params.onVerifying?.();

    const { data: verifyData } = await api.post<{
      success?: boolean;
      currentPeriodEnd?: string;
      alreadyProcessed?: boolean;
    }>(`${API_BASE_URL}/subscription/billing/verify`, {
      planCode: params.planCode,
      razorpay_order_id: paymentResponse.razorpay_order_id,
      razorpay_payment_id: paymentResponse.razorpay_payment_id,
      razorpay_signature: paymentResponse.razorpay_signature,
    });

    if (!verifyData?.success) {
      throw new Error('Payment verification failed');
    }

    const periodEnd =
      verifyData.currentPeriodEnd ??
      new Date(Date.now() + 30 * 86400000).toISOString();

    return {
      transactionId: paymentResponse.razorpay_payment_id,
      planCode: params.planCode,
      planName: order.planName,
      amountInr: order.priceInr,
      currentPeriodEnd: periodEnd,
    };
  },
};

export async function fetchBillingConfig(): Promise<BillingConfig> {
  if (billingConfigCache) return billingConfigCache;

  try {
    const { data } = await api.get<{ success?: boolean; razorpay?: BillingConfig }>(
      `${API_BASE_URL}/subscription/billing/config`,
    );
    billingConfigCache = {
      configured: Boolean(data?.razorpay?.configured && data.razorpay.keyId),
      keyId: data?.razorpay?.keyId ?? null,
      currency: data?.razorpay?.currency ?? 'INR',
      mockAllowed: Boolean(data?.razorpay?.mockAllowed),
    };
  } catch {
    billingConfigCache = { configured: false, keyId: null, currency: 'INR', mockAllowed: false };
  }

  return billingConfigCache;
}

/**
 * Returns active payment provider.
 * Uses Razorpay when backend keys are configured; otherwise mock (dev only).
 */
export async function resolvePaymentProvider(): Promise<PaymentProvider> {
  if (cachedProviderId === 'razorpay') return razorpayPaymentProvider;
  if (cachedProviderId === 'mock') return mockPaymentProvider;

  const config = await fetchBillingConfig();
  if (config.configured) {
    cachedProviderId = 'razorpay';
    return razorpayPaymentProvider;
  }

  cachedProviderId = 'mock';
  return mockPaymentProvider;
}

/** @deprecated Use resolvePaymentProvider() for Razorpay-aware selection */
export function getPaymentProvider(): PaymentProvider {
  return mockPaymentProvider;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BillingHistoryRow {
  id: string;
  transactionId: string;
  status: string;
  amountInr: number;
  currency: string;
  provider: string;
  planCode: string;
  planName: string;
  createdAt: string;
  mock?: boolean;
}

export async function fetchBillingHistory(): Promise<BillingHistoryRow[]> {
  const { data } = await api.get<{ success?: boolean; history?: BillingHistoryRow[] }>(
    `${API_BASE_URL}/subscription/billing/history`,
  );
  return data?.history ?? [];
}
