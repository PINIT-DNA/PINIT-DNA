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

/** Closing the sheet is a choice, not a fault. Callers check this code so a
 *  deliberate exit is not reported to the customer as an error. */
export const CHECKOUT_CANCELLED = 'CHECKOUT_CANCELLED';

function checkoutError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Only send prefill values we actually hold.
 *
 * `contact` was hardcoded to 9876543210 — a made-up number pushed into every
 * customer's checkout. On a UPI or card flow Razorpay uses that number for the
 * payment record and any OTP routing, so a real payment could be attached to a
 * phone belonging to nobody. Omitting the field instead lets Razorpay ask for
 * it once and keep it, which is both correct and fewer keystrokes than
 * correcting a wrong value.
 *
 * An email that Exchange synthesised for an account (…@pinithub.local,
 * …@buyer.local) is not a real inbox, so it is not sent either — a receipt
 * would bounce and Razorpay would show it as the buyer's address.
 */
function buildPrefill({ userName, userEmail, userContact }) {
  const prefill = {};
  const name = String(userName || '').trim();
  const email = String(userEmail || '').trim();
  const contact = String(userContact || '').trim();

  if (name) prefill.name = name;
  if (email && !/@(pinithub|buyer|pinit)\.local$/i.test(email)) prefill.email = email;
  if (contact) prefill.contact = contact;

  return prefill;
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
  userContact,
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
      prefill: buildPrefill({ userName, userEmail, userContact }),
      // Remembers the payer between the subscription and later purchases, so a
      // returning customer sees their saved method instead of starting over.
      remember_customer: true,
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
        // Keeps the sheet from closing on a stray background click mid-payment.
        escape: true,
        backdropclose: false,
        ondismiss: () => reject(checkoutError('Payment cancelled', CHECKOUT_CANCELLED)),
      },
    });

    rzp.on('payment.failed', (response) => {
      reject(new Error(
        response.error?.description || response.error?.reason || 'Payment failed',
      ));
    });

    rzp.open();
  });
}

/**
 * Full pay flow: create-payment → Razorpay or mock verify → sealed order(s).
 * @param {'single'|'cart'} mode
 */
export async function payAndSeal({
  mode = 'single', createBody, description, userName, userEmail, userContact,
}) {
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

  if (created.mock) {
    razorpay_payment_id = `pay_mock_${Date.now()}`;
    razorpay_signature = 'mock';
  } else {
    if (!created.keyId || !created.orderId) {
      throw new Error(created.message || 'Payment is not configured. Cannot charge without a Razorpay order.');
    }
    const paid = await openRazorpayCheckout({
      keyId: created.keyId,
      orderId: created.orderId,
      amount: created.amount,
      currency: created.currency || 'INR',
      description,
      userName,
      userEmail,
      userContact,
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
