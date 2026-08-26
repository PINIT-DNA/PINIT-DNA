import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, CreditCard, ArrowRight, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { loadRazorpayScript, openRazorpayCheckout, CHECKOUT_CANCELLED } from '../lib/razorpay-checkout.js';
import { sellerNeedsPaymentVerification } from '../lib/seller-onboarding.js';
import TestPaymentHint from '../components/TestPaymentHint.jsx';
import { sellerSubscriptionLabel } from '../lib/money.js';

const STATUS_TIMEOUT_MS = 20000;

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

export default function SellerPaymentOnboarding({ user, onVerified, onNavigate }) {
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
      const { ok, data, error: err } = await fetchWithTimeout(
        `/api/seller/onboarding/status?pinit_id=${encodeURIComponent(user.pinit_id)}`,
      );
      if (!ok) {
        setError(err || 'Could not load onboarding status');
        setStatus(null);
        return;
      }
      setStatus(data);
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
      const idempotencyKey = `spm_${user.pinit_id}_${Date.now()}`;
      const init = await fetchWithTimeout('/api/seller/onboarding/payment-method', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ pinit_id: user.pinit_id, idempotency_key: idempotencyKey }),
      });
      if (!init.ok) throw new Error(init.error || 'Could not start payment verification');
      const created = init.data || {};
      if (created.already_verified) {
        finishAsCreator(created.user);
        return;
      }

      let razorpay_order_id = created.orderId;
      let razorpay_payment_id = null;
      let razorpay_signature = null;

      if (created.mock || !created.keyId) {
        razorpay_payment_id = `pay_mock_${Date.now()}`;
        razorpay_signature = 'mock';
      } else {
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

      const verify = await fetchWithTimeout('/api/seller/onboarding/payment-method/verify', {
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
        <div className="modal-content" style={{ padding: 28 }}>
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
            Continue to Creator account <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell" style={{ maxWidth: 560, margin: '48px auto', padding: '0 24px' }}>
      <div className="modal-content" style={{ padding: 28 }}>
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
          <div style={{ color: '#f87171', fontSize: '0.9rem', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <RefreshCw size={14} /> {error}
          </div>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={verifying}
          onClick={startVerification}
        >
          {verifying ? 'Processing payment…' : `Pay ${sellerSubscriptionLabel()}`}
        </button>
      </div>
    </div>
  );
}
