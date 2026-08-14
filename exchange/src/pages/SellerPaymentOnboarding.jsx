import React, { useEffect, useState } from 'react';
import { ShieldCheck, CreditCard, ArrowRight, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { loadRazorpayScript, openRazorpayCheckout } from '../lib/razorpay-checkout.js';
import { sellerNeedsPaymentVerification } from '../lib/seller-onboarding.js';

export default function SellerPaymentOnboarding({ user, onVerified, onNavigate }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = async () => {
    if (!user?.pinit_id) return;
    setLoading(true);
    setError('');
    const { ok, data, error: err } = await apiFetch(
      `/api/seller/onboarding/status?pinit_id=${encodeURIComponent(user.pinit_id)}`,
    );
    setLoading(false);
    if (!ok) {
      setError(err || 'Could not load onboarding status');
      return;
    }
    setStatus(data);
    if (data?.seller_onboarding_complete) {
      onVerified?.(data.user);
    }
  };

  useEffect(() => {
    loadStatus();
  }, [user?.pinit_id]);

  const startVerification = async () => {
    if (!user?.pinit_id) return;
    setVerifying(true);
    setError('');
    try {
      const idempotencyKey = `spm_${user.pinit_id}_${Date.now()}`;
      const init = await apiFetch('/api/seller/onboarding/payment-method', {
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
        onVerified?.(created.user);
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
          description: created.description || 'Payment method verification',
          userName: user.display_name || user.name,
          userEmail: user.email,
        });
        razorpay_order_id = paid.razorpay_order_id;
        razorpay_payment_id = paid.razorpay_payment_id;
        razorpay_signature = paid.razorpay_signature;
      }

      const verify = await apiFetch('/api/seller/onboarding/payment-method/verify', {
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
      onVerified?.(verify.data?.user);
      setStatus(verify.data);
    } catch (e) {
      setError(e.message || 'Payment verification failed');
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
            Your seller account is verified. No registration fee was charged.
          </p>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => onNavigate?.('seller_listings')}
          >
            Continue to Seller Dashboard <ArrowRight size={16} />
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
          <h2 style={{ margin: 0, color: '#fff' }}>Become a Seller</h2>
        </div>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 8 }}>
          Create your seller account for free. To protect the marketplace and reduce fraudulent seller
          accounts, a verified payment method is required before you can list assets.
        </p>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: 20 }}>
          No seller registration fee. Selling and listing remain free — transaction fees follow existing Pinit rules.
        </p>
        {status?.billing?.mock && (
          <p style={{ color: 'var(--amber)', fontSize: '0.82rem', marginBottom: 12 }}>
            Dev mode: mock payment verification (no real charge).
          </p>
        )}
        {!status?.billing?.mock && status?.verification_hold_paise > 0 && (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.82rem', marginBottom: 12 }}>
            A temporary ₹1 verification hold may apply during setup and is refunded automatically — not a registration fee.
          </p>
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
          {verifying ? 'Verifying…' : 'Add Payment Method'}
        </button>
      </div>
    </div>
  );
}
