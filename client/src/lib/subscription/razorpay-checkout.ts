export interface RazorpaySuccessResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayCheckoutOptions {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  planName: string;
  userName?: string;
  userEmail?: string;
}

interface RazorpayErrorResponse {
  error?: {
    description?: string;
    reason?: string;
  };
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: (response: RazorpayErrorResponse) => void): void;
}

interface RazorpayConstructorOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { name?: string; email?: string };
  theme?: { color?: string };
  handler: (response: RazorpaySuccessResponse) => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayConstructorOptions) => RazorpayInstance;
  }
}

let scriptPromise: Promise<void> | null = null;

export function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay checkout'));
    document.body.appendChild(script);
  });

  return scriptPromise;
}

export async function openRazorpayCheckout(
  options: RazorpayCheckoutOptions,
): Promise<RazorpaySuccessResponse> {
  await loadRazorpayScript();

  if (!window.Razorpay) {
    throw new Error('Razorpay checkout is unavailable');
  }

  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: options.keyId,
      amount: options.amount,
      currency: options.currency,
      name: 'PINITHub',
      description: `${options.planName} subscription`,
      order_id: options.orderId,
      prefill: {
        name: options.userName,
        email: options.userEmail,
      },
      theme: { color: '#3b9eff' },
      handler: (response) => resolve(response),
      modal: {
        ondismiss: () => reject(new Error('Payment cancelled')),
      },
    });

    rzp.on('payment.failed', (response) => {
      reject(new Error(response.error?.description || response.error?.reason || 'Payment failed'));
    });

    rzp.open();
  });
}
