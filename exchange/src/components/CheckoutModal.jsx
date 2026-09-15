import { formatMoney, setPlatformCurrency } from '../lib/money.js';
import React, { useState, useEffect, useRef } from 'react';
import { X, ShieldCheck, Award, Download, Eye } from 'lucide-react';
import { payAndSeal, CHECKOUT_CANCELLED, CHECKOUT_REDIRECTING } from '../lib/razorpay-checkout.js';
import { apiFetch } from '../lib/api.js';
import TestPaymentHint from './TestPaymentHint.jsx';

function defaultBuyer(user) {
  const name = user?.display_name || user?.name || 'Pinit Buyer';
  const email =
    user?.email ||
    (user?.pinit_id
      ? `${String(user.pinit_id).toLowerCase().replace(/[^a-z0-9]/g, '')}@buyer.local`
      : 'buyer@pinit.local');
  return { name, email, org: user?.org_name || '' };
}

export default function CheckoutModal({ isOpen, onClose, listing, onOrderCompleted, onViewPurchases, user }) {
  const [tier, setTier] = useState('commercial');
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerOrg, setBuyerOrg] = useState('');

  const [loading, setLoading] = useState(false);
  const [payPhase, setPayPhase] = useState('ready');
  const [completedOrder, setCompletedOrder] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [cancelMsg, setCancelMsg] = useState('');
  // Licence terms must be accepted before payment is taken. Unchecked by
  // default and reset on every open — never pre-consented.
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [payMode, setPayMode] = useState(null);
  const autoPayRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      autoPayRef.current = false;
      return;
    }
    setCompletedOrder(null);
    setErrorMsg('');
    setCancelMsg('');
    setPayPhase('ready');
    setAcceptedTerms(false);
    const defaults = defaultBuyer(user);
    setBuyerName(defaults.name);
    setBuyerEmail(defaults.email);
    setBuyerOrg(defaults.org);
    apiFetch('/api/orders/billing/config').then((parsed) => {
      if (parsed.ok && parsed.data) {
        // The client formats prices in whatever currency the gateway charges,
        // so the browse price and the receipt can never disagree.
        setPlatformCurrency(parsed.data.currency);
        setTestMode(Boolean(parsed.data.testMode));
        setPayMode(parsed.data.mock ? 'mock' : 'razorpay');
        return;
      }
      setPayMode('mock');
    });
  }, [isOpen, user, listing?.listing_id]);

  const runCheckout = async (name = buyerName, email = buyerEmail, org = buyerOrg) => {
    if (!acceptedTerms) {
      setErrorMsg('Please accept the licence terms before continuing.');
      setPayPhase('failure');
      return;
    }
    const defaults = defaultBuyer(user);
    const buyer_name = String(name || defaults.name).trim();
    const buyer_email = String(email || defaults.email).trim();
    setLoading(true);
    setPayPhase('processing');
    setErrorMsg('');
    try {
      const verified = await payAndSeal({
        mode: 'single',
        createBody: {
          listing_id: listing.listing_id,
          license_tier: tier,
          buyer_name,
          buyer_email,
          buyer_org: org || '',
          buyer_pinit_id: user?.pinit_id,
          accept_terms: true,
        },
        description: `${listing.title} · ${tier} license`,
        userName: buyer_name,
        userEmail: buyer_email,
        userContact: user?.phone || user?.contact || '',
      });

      if (verified.pending_delivery && !verified.order) {
        setPayPhase('verifying');
        setErrorMsg('Payment was received, but license delivery is still being prepared.');
        return;
      }
      if (!verified.order) {
        setPayPhase('failure');
        setErrorMsg('Payment could not be completed. No license was created.');
        return;
      }
      setCompletedOrder(verified.order);
      setPayPhase('success');
      onOrderCompleted?.(verified.order);
    } catch (err) {
      // A buyer who closed the sheet has not failed at anything, and nothing
      // was charged. Saying "Payment cancelled" in red implied a problem with
      // their card and left them unsure whether they had been billed.
      if (err.code === CHECKOUT_REDIRECTING) {
        setPayPhase('processing');
        setErrorMsg('');
        setCancelMsg('Redirecting to Razorpay…');
        return;
      }
      if (err.code === CHECKOUT_CANCELLED) {
        setPayPhase('ready');
        setErrorMsg('');
        setCancelMsg('Payment cancelled — nothing was charged. Your selection is still here.');
      } else {
        setPayPhase('failure');
        setCancelMsg('');
        setErrorMsg(err.message || 'Payment could not be completed. No license was created.');
      }
      autoPayRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Auto-success in mock mode still requires the buyer to accept terms,
    // otherwise the consent record would be silently skipped in dev.
    if (!isOpen || payMode !== 'mock' || !listing || completedOrder || autoPayRef.current) return;
    if (!acceptedTerms) return;
    autoPayRef.current = true;
    const defaults = defaultBuyer(user);
    void runCheckout(defaults.name, defaults.email, defaults.org);
  }, [isOpen, payMode, listing?.listing_id, acceptedTerms]);

  const openLicensedAccess = async (order, download) => {
    setErrorMsg('');
    const direct = download
      ? (order.download_intent_url || (order.share_url || order.view_url
        ? `${order.share_url || order.view_url}${(order.share_url || order.view_url).includes('?') ? '&' : '?'}download=1`
        : null))
      : (order.view_url || order.share_url);
    if (direct && !String(direct).includes('/exchange/delivery/')) {
      window.location.assign(direct);
      return;
    }
    const { ok, data, error } = await apiFetch('/api/orders/download/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seal_id: order.seal_id, asset_id: order.asset_id }),
    });
    const url = download
      ? (data?.download_intent_url || data?.share_url)
      : (data?.view_url || data?.share_url);
    if (!ok || !url || String(url).includes('/exchange/delivery/')) {
      setErrorMsg(error || 'Access is not ready yet. Open Purchases in a moment.');
      return;
    }
    window.location.assign(download && !url.includes('download=')
      ? `${url}${url.includes('?') ? '&' : '?'}download=1`
      : url);
  };

  // Must come after every hook above — an early return here would change how many
  // hooks run between the closed and open renders (React error #310).
  if (!isOpen || !listing) return null;

  const getPriceForTier = (t) => {
    if (t === 'personal') return listing.price_personal || 49;
    if (t === 'commercial') return listing.price_commercial || 149;
    if (t === 'exclusive') return listing.price_exclusive || 899;
    if (t === 'enterprise') return listing.price_enterprise || 2499;
    return listing.price_personal || 49;
  };

  const selectedPrice = getPriceForTier(tier);

  const handleProcessCheckout = async (e) => {
    e.preventDefault();
    await runCheckout();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ShieldCheck size={22} color="var(--primary)" />
            <div>
              <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>
                {completedOrder ? 'License sealed' : 'Checkout & Seal License'}
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {completedOrder
                  ? 'Payment verified · licensed delivery is ready'
                  : payPhase === 'processing'
                    ? 'Processing payment…'
                    : payMode === 'razorpay'
                      ? 'Pay with Razorpay · then provenance seal'
                      : 'Auto-filling buyer details · payment marked successful'}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {completedOrder ? (
          <div className="modal-body">
            <div className="certificate-box" style={{ marginBottom: '20px' }}>
              <div className="certificate-stamp">LICENSE SEALED</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>
                Licensed asset
              </div>
              <h4 style={{ fontSize: '1.3rem', color: '#fff', marginBottom: '12px' }}>{completedOrder.title}</h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                <div>Creator: <strong style={{ color: '#fff' }}>{listing.creator_name || listing.pinit_id}</strong></div>
                <div>License: <strong style={{ color: 'var(--emerald)' }}>{String(completedOrder.license_tier).toUpperCase()}</strong></div>
                <div>Order: <strong style={{ color: '#fff' }}>{completedOrder.order_id}</strong></div>
                <div>Amount: <strong style={{ color: '#fff' }}>
                  {formatMoney(completedOrder.price_paid, completedOrder.currency)}
                </strong></div>
                <div>Payment: <strong style={{ color: '#fff' }}>{completedOrder.payment_status || 'Paid'}</strong></div>
                <div>Delivery: <strong style={{ color: '#fff' }}>{completedOrder.hub_seal?.error ? 'Preparing' : 'Ready'}</strong></div>
              </div>

              {completedOrder.hub_seal?.error && (
                <div style={{ marginTop: 12, fontSize: '0.82rem', color: 'var(--badge-gold)' }}>
                  Payment was received, but license delivery is still being prepared.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                onClick={() => openLicensedAccess(completedOrder, false)}
              >
                <Eye size={16} /> View licensed asset
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1, justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                onClick={() => openLicensedAccess(completedOrder, true)}
              >
                <Download size={16} /> Download licensed file
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  onClose();
                  onViewPurchases?.();
                }}
              >
                View purchase
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleProcessCheckout} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div className="modal-body">
              {cancelMsg && (
                <div style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', padding: '10px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.85rem' }}>
                  {cancelMsg}
                </div>
              )}
              {errorMsg && (
                <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '10px', borderRadius: '6px', marginBottom: '14px', fontSize: '0.85rem' }}>
                  {errorMsg}
                </div>
              )}

              <div style={{ display: 'flex', gap: '16px', background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: 'var(--radius-sm)', marginBottom: '18px' }}>
                <img
                  src={listing.preview_url || 'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=800&q=80'}
                  alt={listing.title}
                  style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px' }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span className={`badge-${String(listing.badge_tier || 'bronze').toLowerCase()}`}>
                      <Award size={12} /> {listing.badge_tier} Badge
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{listing.human_percent}% Human Originality</span>
                  </div>
                  <h4 style={{ fontSize: '1.05rem', color: '#fff' }}>{listing.title}</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Creator: {listing.creator_name || 'Creator'} ({listing.pinit_id})</p>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Select License Tier</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {[
                    { id: 'personal', name: 'Personal License', price: listing.price_personal || 49, desc: 'Individual projects & personal portfolio' },
                    { id: 'commercial', name: 'Commercial License', price: listing.price_commercial || 149, desc: 'Client work, marketing, online monetization' },
                    { id: 'exclusive', name: 'Exclusive Buyout', price: listing.price_exclusive || 899, desc: 'Full ownership buyout, delists from Exchange' },
                    { id: 'enterprise', name: 'Enterprise Seat', price: listing.price_enterprise || 2499, desc: 'Unlimited team seats + institutional indemnity' },
                  ].map((t) => (
                    <div
                      key={t.id}
                      onClick={() => setTier(t.id)}
                      style={{
                        border: tier === t.id ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        background: tier === t.id ? 'rgba(59, 130, 246, 0.1)' : 'rgba(0,0,0,0.2)',
                        padding: '12px',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '0.9rem', color: '#fff' }}>
                        <span>{t.name}</span>
                        <span style={{ color: 'var(--emerald)' }}>{formatMoney(t.price)}</span>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>{t.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Buyer Full Name</label>
                  <input type="text" className="form-input" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Buyer Email</label>
                  <input type="email" className="form-input" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} required />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Company / Organization Name</label>
                <input type="text" className="form-input" value={buyerOrg} onChange={(e) => setBuyerOrg(e.target.value)} />
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid var(--border-subtle)',
                padding: '14px',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '10px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>License Subtotal:</span>
                  <span style={{ color: '#fff' }}>{formatMoney(selectedPrice)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Payment rail:</span>
                  <span style={{ color: 'var(--emerald)' }}>{payMode === 'razorpay' ? (testMode ? 'Razorpay test' : 'Razorpay') : 'Test checkout (not live payment)'}</span>
                </div>
                {/* Shared with the seller activation screen, so the working
                    sandbox method is stated in one place rather than being
                    copied — and cannot drift between the two. */}
                {payMode === 'razorpay' && (
                  <TestPaymentHint billing={{ testMode: true, mock: false }} className="pay-hint--tight" />
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 800, color: '#fff', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                  <span>Total Due:</span>
                  <span style={{ color: 'var(--emerald)' }}>{formatMoney(selectedPrice)}</span>
                </div>
              </div>

              {testMode && (
                <p role="status" style={{
                  fontSize: '0.78rem', color: 'var(--amber, #d99a2b)', lineHeight: 1.5,
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                  padding: '8px 10px', margin: '0 0 10px',
                }}>
                  Test mode — this checkout uses a Razorpay test key. No real payment is taken.
                </p>
              )}

              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 9,
                fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5,
                cursor: 'pointer', marginBottom: 4,
              }}>
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => { setAcceptedTerms(e.target.checked); setErrorMsg(''); }}
                  style={{ marginTop: 3, flexShrink: 0 }}
                />
                <span>
                  I accept the <strong style={{ color: '#fff' }}>{String(tier).toLowerCase()} licence terms</strong> for this
                  asset, and understand the licence is issued to my PINIT ID and is non-transferable.
                </span>
              </label>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={loading || !acceptedTerms}>
                {payPhase === 'processing' || loading
                  ? (payMode === 'mock' ? 'Auto-completing payment…' : 'Processing payment…')
                  : payPhase === 'failure'
                    ? 'Payment failed — Try again'
                    : payMode === 'razorpay'
                      ? `Pay ${formatMoney(selectedPrice)} with Razorpay`
                      : `Confirm ${formatMoney(selectedPrice)} · auto-success`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
