import React, { useState } from 'react';
import { X, Sparkles, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

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
            <h3 style={{ color: '#fff', fontSize: '1.15rem' }}>Become a Creator</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              Uploading to Pinit HUB stays private. Selling on Exchange is a separate, controlled step.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
            Creator accounts can list and earn. They cannot purchase marketplace assets.
            Your Hub vault stays yours either way.
          </p>
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
            {loading ? 'Updating…' : 'Become a Creator'}
          </button>
        </div>
      </div>
    </div>
  );
}
