import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, CreditCard, ArrowRight, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { loadRazorpayScript, openRazorpayCheckout, CHECKOUT_CANCELLED } from '../lib/razorpay-checkout.js';
import { sellerNeedsPaymentVerification } from '../lib/seller-onboarding.js';
import TestPaymentHint from '../components/TestPaymentHint.jsx';
import { sellerSubscriptionLabel } from '../lib/money.js';

const STATUS_TIMEOUT_MS = 15000;
const PAY_TIMEOUT_MS = 45000;

function isTransientApiFailure(result) {
  if (!result || result.ok) return false;
  if (result.status === 0 || result.status === 502 || result.status === 503 || result.status === 504) {
    return true;
  }
  // Vite proxy returns empty 500 when Exchange is mid-restart.
  if (result.status === 500 && (!result.data || /empty response|server error|try again/i.test(String(result.error || '')))) {
    return true;
  }
  return /timed out|aborted|cannot reach|ECONN/i.test(String(result.error || ''));
}

async function fetchWithTimeout(url, options = {}, ms = STATUS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const result = await apiFetch(url, { ...options, signal: controller.signal });
    if (
      !result.ok &&
      (controller.signal.aborted || /aborted|timeout/i.test(String(result.error || '')))
    ) {
      return { ok: false, status: 0, data: null, error: 'Request timed out. Try again.' };
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, options = {}, { attempts = 2, delayMs = 400, timeoutMs = STATUS_TIMEOUT_MS } = {}) {
  let last = { ok: false, status: 0, data: null, error: 'Could not reach Exchange API' };
  for (let i = 0; i < attempts; i += 1) {
    last = await fetchWithTimeout(url, options, timeoutMs);
    if (last.ok || !isTransientApiFailure(last)) return last;
    await new Promise((r) => setTimeout(r, delayMs + i * 250));
  }
  return last;
}

function payReturnParams() {
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

function clearPayReturnQuery() {
  if (typeof window === 'undefined') return;
  const url = `${window.location.pathname}`;
  window.history.replaceState({}, '', url);
}

export default function SellerPaymentOnboarding({ user, onVerified, onNavigate, onSessionUser }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const finishingRef = useRef(false);

  const finishAsCreator = (updatedUser) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const next = updatedUser || user;
    onVerified?.(next);
  };

  const loadStatus = async () => {
    if (!user?.pinit_id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { ok, data, error: err } = await fetchWithRetry(
        `/api/seller/onboarding/status?pinit_id=${encodeURIComponent(user.pinit_id)}`,
      );
      if (!ok) {
        setError(err || 'Could not load onboarding status');
        setStatus(null);
        return;
      }
      setStatus(data);
      if (data?.user) onSessionUser?.(data.user);
      if (data?.seller_onboarding_complete) {
        finishAsCreator(data.user || user);
      }
    } catch (e) {
      setError(e.message || 'Could not load onboarding status');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    finishingRef.current = false;
    const returned = payReturnParams();
    if (returned?.razorpay_payment_id && user?.pinit_id) {
      (async () => {
        setVerifying(true);
        setNotice('Confirming payment…');
        setError('');
        try {
          const verify = await fetchWithRetry('/api/seller/onboarding/payment-method/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pinit_id: user.pinit_id, ...returned }),
          }, { timeoutMs: PAY_TIMEOUT_MS });
          if (!verify.ok) throw new Error(verify.error || 'Verification failed');
          clearPayReturnQuery();
          if (verify.data?.user) onSessionUser?.(verify.data.user);
          setStatus(verify.data);
          finishAsCreator(verify.data?.user);
        } catch (e) {
          setNotice('');
          setError(e.message || 'Payment verification failed');
          setVerifying(false);
          await loadStatus();
        }
      })();
      return;
    }
    loadStatus();
  }, [user?.pinit_id]);

  const startVerification = async () => {
    if (!user?.pinit_id) {
      setError('Sign in again to continue payment.');
      return;
    }
    if (verifying) return;

    setVerifying(true);
    setError('');
    setNotice('');
    try {
      const idempotencyKey = `seller_pm_${user.pinit_id}_${Date.now()}`;
      setNotice('Opening payment…');
      const init = await fetchWithRetry('/api/seller/onboarding/payment-method', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ pinit_id: user.pinit_id, idempotency_key: idempotencyKey }),
      }, { timeoutMs: PAY_TIMEOUT_MS });
      if (!init.ok) throw new Error(init.error || 'Could not start payment verification');
      const created = init.data || {};
      if (created.already_verified) {
        if (created.user) onSessionUser?.(created.user);
        finishAsCreator(created.user);
        return;
      }

      let razorpay_order_id = created.orderId;
      let razorpay_payment_id = null;
      let razorpay_signature = null;

      if (created.mock) {
        setNotice('Confirming test payment…');
        razorpay_payment_id = `pay_mock_${Date.now()}`;
        razorpay_signature = 'mock';
      } else if (created.checkoutUrl) {
        setNotice('Redirecting to Razorpay…');
        window.location.assign(created.checkoutUrl);
        return;
      } else {
        if (!created.keyId || !created.orderId) {
          throw new Error(created.message || 'Payment is not configured. Cannot charge without a Razorpay order.');
        }
        setNotice('Opening Razorpay…');
        await loadRazorpayScript();
        const paid = await openRazorpayCheckout({
          keyId: created.keyId,
          orderId: created.orderId,
          amount: created.amount,
          currency: created.currency || 'INR',
          description: created.description || `Seller subscription — ${sellerSubscriptionLabel()}`,
          userName: user.display_name || user.name,
          userEmail: user.email,
          userContact: user.phone || user.contact || '',
        });
        razorpay_order_id = paid.razorpay_order_id;
        razorpay_payment_id = paid.razorpay_payment_id;
        razorpay_signature = paid.razorpay_signature;
      }

      const verify = await fetchWithRetry('/api/seller/onboarding/payment-method/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          pinit_id: user.pinit_id,
          idempotency_key: idempotencyKey,
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
        }),
      });
      if (!verify.ok) throw new Error(verify.error || 'Verification failed');
      if (verify.data?.user) onSessionUser?.(verify.data.user);
      setStatus(verify.data);
      finishAsCreator(verify.data?.user);
    } catch (e) {
      if (e.code === CHECKOUT_CANCELLED) {
        setError('');
        setNotice('Payment cancelled — your account is unchanged. You can pay whenever you are ready.');
      } else {
        setNotice('');
        setError(e.message || 'Payment verification failed');
      }
      await loadStatus();
    } finally {
      setVerifying(false);
    }
  };

  if (!user?.pinit_id) {
    return (
      <div className="page-shell" style={{ padding: 48, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Sign in with Pinit HUB to continue seller onboarding.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page-shell" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading seller onboarding…
        {error && (
          <div style={{ marginTop: 16 }}>
            <div style={{ color: '#f87171', marginBottom: 12 }}>{error}</div>
            <button type="button" className="btn-primary" onClick={loadStatus}>
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  const complete = status?.seller_onboarding_complete;
  const needsPayment = sellerNeedsPaymentVerification(user, status);

  if (complete && !needsPayment) {
    return (
      <div className="page-shell" style={{ maxWidth: 560, margin: '48px auto', padding: '0 24px' }}>
        <div className="pay-panel" style={{ padding: 28 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <ShieldCheck size={22} color="var(--emerald)" />
            <h2 style={{ margin: 0, color: '#fff' }}>You&apos;re ready to sell</h2>
          </div>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Your seller subscription is active. You can list and sell on Exchange.
          </p>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => finishAsCreator(status?.user || user)}
          >
            Continue to seller dashboard <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell" style={{ maxWidth: 560, margin: '48px auto', padding: '0 24px' }}>
      <div className="pay-panel" style={{ padding: 28 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <CreditCard size={22} color="#60a5fa" />
          <h2 style={{ margin: 0, color: '#fff' }}>Pay seller subscription</h2>
        </div>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 8 }}>
          Complete payment to activate your Exchange seller account and start listing.
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            padding: '12px 14px',
            marginBottom: 16,
            borderRadius: 10,
            background: 'rgba(59,130,246,0.12)',
            border: '1px solid rgba(59,130,246,0.28)',
          }}
        >
          <span style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>Seller subscription</span>
          <strong style={{ color: '#fff', fontSize: '1.35rem' }}>{sellerSubscriptionLabel()}</strong>
        </div>
        <TestPaymentHint billing={status?.billing} className="pay-hint--stack" />
        {notice && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <RefreshCw size={14} /> {notice}
          </div>
        )}
        {error && (
          <div style={{ color: '#f87171', fontSize: '0.9rem', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <RefreshCw size={14} /> {error}
            <button
              type="button"
              className="btn-secondary"
              style={{ marginLeft: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
              onClick={loadStatus}
            >
              Retry
            </button>
          </div>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={verifying}
          style={{ width: '100%', minHeight: 48, marginTop: 8 }}
          onClick={startVerification}
        >
          {verifying ? 'Opening payment…' : `Pay ${sellerSubscriptionLabel()}`}
        </button>
      </div>
    </div>
  );
}
