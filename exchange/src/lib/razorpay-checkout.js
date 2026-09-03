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
    const fail = (message) => {
      scriptPromise = null;
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail('Razorpay checkout took too long to load. Check your network and try Pay again.'), 12000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.Razorpay) resolve();
      else fail('Razorpay checkout failed to initialize.');
    };
    script.onerror = () => {
      clearTimeout(timer);
      fail('Could not load Razorpay. Disable ad blockers for checkout.razorpay.com and try again.');
    };
    document.body.appendChild(script);
  });

  return scriptPromise;
}

/** Closing the sheet is a choice, not a fault. Callers check this code so a
 *  deliberate exit is not reported to the customer as an error. */
export const CHECKOUT_CANCELLED = 'CHECKOUT_CANCELLED';
export const CHECKOUT_REDIRECTING = 'CHECKOUT_REDIRECTING';
export const PAY_INTENT_STORAGE_KEY = 'pinit_pay_intent';

export function payReturnParams() {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  const paymentId = q.get('razorpay_payment_id');
  if (!paymentId) return null;
  return {
    razorpay_payment_id: paymentId,
    razorpay_order_id: q.get('razorpay_order_id') || '',
    razorpay_signature: q.get('razorpay_signature') || '',
    razorpay_payment_link_id: q.get('razorpay_payment_link_id') || '',
    razorpay_payment_link_reference_id: q.get('razorpay_payment_link_reference_id') || '',
    razorpay_payment_link_status: q.get('razorpay_payment_link_status') || '',
  };
}

export function storedPayIntent() {
  try {
    const raw = sessionStorage.getItem(PAY_INTENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPayReturnQuery() {
  if (typeof window === 'undefined') return;
  window.history.replaceState({}, '', window.location.pathname);
}

function setCheckoutOverlay(open) {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('razorpay-checkout-open', Boolean(open));
}

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
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      setCheckoutOverlay(false);
      clearTimeout(watchdog);
      fn(value);
    };
    const watchdog = setTimeout(() => {
      finish(reject, new Error('Payment window did not complete. Click Pay to try again.'));
    }, 5 * 60 * 1000);

    setCheckoutOverlay(true);
    const rzp = new window.Razorpay({
      key: keyId,
      amount,
      currency,
      name: 'Pinit Exchange',
      description,
      order_id: orderId,
      prefill: buildPrefill({ userName, userEmail, userContact }),
      theme: { color: '#3b82f6' },
      handler: (response) => finish(resolve, response),
      modal: {
        escape: true,
        backdropclose: false,
        ondismiss: () => finish(reject, checkoutError('Payment cancelled', CHECKOUT_CANCELLED)),
      },
    });

    rzp.on('payment.failed', (response) => {
      finish(reject, new Error(
        response.error?.description || response.error?.reason || 'Payment failed',
      ));
    });

    try {
      rzp.open();
    } catch (err) {
      finish(reject, err instanceof Error ? err : new Error('Could not open Razorpay checkout'));
    }
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
  } else if (created.checkoutUrl) {
    try {
      sessionStorage.setItem(PAY_INTENT_STORAGE_KEY, JSON.stringify({
        payment_intent_id: created.payment_intent_id,
        orderId: created.orderId,
        mode,
      }));
    } catch {
      /* ignore */
    }
    window.location.assign(created.checkoutUrl);
    const err = new Error('Redirecting to Razorpay…');
    err.code = CHECKOUT_REDIRECTING;
    throw err;
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
