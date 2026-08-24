import React, { useState } from 'react';
import { X, Sparkles, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { sellerSubscriptionLabel } from '../lib/money.js';

export default function BecomeCreatorModal({ isOpen, onClose, user, onConverted }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const convert = async () => {
    if (!user?.pinit_id) return;
    setLoading(true);
    setError('');
    const { ok, data, error: err } = await apiFetch('/api/auth/become-creator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinit_id: user.pinit_id }),
    });
    setLoading(false);
    if (!ok) {
      setError(err || 'Could not convert account');
      return;
    }
    onConverted?.(data.user);
    onClose?.();
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-header">
          <div>
            <h3 style={{ color: '#fff', fontSize: '1.15rem' }}>Become a Seller</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              Create an Exchange seller account, then subscribe to list and sell.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
            Hub stays your private workspace. Selling on Exchange requires a seller subscription.
          </p>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(59,130,246,0.12)',
              border: '1px solid rgba(59,130,246,0.28)',
            }}
          >
            <span style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>Seller subscription</span>
            <strong style={{ color: '#fff', fontSize: '1.25rem' }}>{sellerSubscriptionLabel()}</strong>
          </div>
          <div style={{ display: 'flex', gap: 8, color: 'var(--emerald)', fontSize: '0.82rem' }}>
            <Sparkles size={15} /> Create, protect, list and earn from creative assets.
          </div>
          <div style={{ display: 'flex', gap: 8, color: 'var(--text-dim)', fontSize: '0.82rem' }}>
            <ShieldCheck size={15} /> Pinit HUB remains your private workspace.
          </div>
          {error && <div style={{ color: '#f87171', fontSize: '0.85rem' }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Keep buyer account</button>
          <button type="button" className="btn-primary" disabled={loading || !user} onClick={convert}>
            {loading ? 'Creating account…' : 'Subscribe'}
          </button>
        </div>
      </div>
    </div>
  );
}
