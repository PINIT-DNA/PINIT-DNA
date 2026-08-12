import { apiFetch } from './api.js';

let scriptPromise = null;

async function postJsonWithRetry(url, body, { attempts = 2 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (last.ok) return last;
    const retryable =
      last.status === 0 ||
      last.status >= 500 ||
      String(last.error || '').includes('Empty response') ||
      String(last.error || '').includes('Cannot reach');
    if (!retryable || i === attempts - 1) return last;
    await new Promise((r) => setTimeout(r, 600));
  }
  return last;
}

export function loadRazorpayScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
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

/**
 * Open Razorpay Checkout.js. Resolves with payment ids on success.
 */
export async function openRazorpayCheckout({
  keyId,
  orderId,
  amount,
  currency = 'INR',
  description = 'Pinit Exchange license',
  userName,
  userEmail,
}) {
  await loadRazorpayScript();
  if (!window.Razorpay) throw new Error('Razorpay checkout is unavailable');

  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: keyId,
      amount,
      currency,
      name: 'Pinit Exchange',
      description,
      order_id: orderId,
      prefill: { name: userName, email: userEmail, contact: '9876543210' },
      method: {
        upi: true,
        card: true,
        netbanking: true,
        wallet: true,
        emi: false,
        paylater: false,
      },
      theme: { color: '#3b82f6' },
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

/**
 * Full pay flow: create-payment → Razorpay or mock verify → sealed order(s).
 * @param {'single'|'cart'} mode
 */
export async function payAndSeal({ mode = 'single', createBody, description, userName, userEmail }) {
  const createUrl =
    mode === 'cart' ? '/api/commerce/cart/create-payment' : '/api/orders/create-payment';

  const createParsed = await postJsonWithRetry(createUrl, createBody);
  if (!createParsed.ok) {
    throw new Error(createParsed.error || 'Could not create payment. Try again.');
  }
  const created = createParsed.data || {};

  let razorpay_order_id = created.orderId;
  let razorpay_payment_id = null;
  let razorpay_signature = null;

  if (created.mock || !created.keyId) {
    razorpay_payment_id = `pay_mock_${Date.now()}`;
    razorpay_signature = 'mock';
  } else {
    const paid = await openRazorpayCheckout({
      keyId: created.keyId,
      orderId: created.orderId,
      amount: created.amount,
      currency: created.currency || 'INR',
      description,
      userName,
      userEmail,
    });
    razorpay_order_id = paid.razorpay_order_id;
    razorpay_payment_id = paid.razorpay_payment_id;
    razorpay_signature = paid.razorpay_signature;
  }

  const verifyParsed = await postJsonWithRetry('/api/orders/verify-payment', {
    payment_intent_id: created.payment_intent_id,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  });
  if (!verifyParsed.ok) {
    throw new Error(verifyParsed.error || 'Payment verification failed. Try again.');
  }
  return verifyParsed.data;
}
