import React from 'react';
import { X, ShieldCheck, Check, Award } from 'lucide-react';
import { verifiedLabel, verticalLabel } from '../lib/api.js';

/**
 * Provenance / Trust drawer — commercial language only (no SHA/DCT/LSB).
 */
export default function ProvenanceDrawer({ open, onClose, listing }) {
  if (!open) return null;

  const human = listing?.human_percent;
  const ai = listing?.ai_percent;

  return (
    <div className="provenance-drawer-root" role="dialog" aria-modal="true">
      <div className="provenance-drawer-backdrop" onClick={onClose} />
      <aside className="provenance-drawer">
        <div className="provenance-drawer__header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--emerald)', marginBottom: 4 }}>
              <ShieldCheck size={18} />
              <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Pinit HUB Verification</span>
            </div>
            <h3 style={{ color: '#fff', fontSize: '1.15rem', margin: 0 }}>{listing?.title || 'Asset'}</h3>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose} aria-label="Close" style={{ padding: 8 }}>
            <X size={16} />
          </button>
        </div>

        <div className="provenance-drawer__body">
          <div className="glass-panel" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Award size={16} color="var(--badge-gold)" />
              <strong style={{ color: '#fff' }}>{verifiedLabel(listing?.badge_tier)}</strong>
            </div>
            <ul className="hub-trust-card__list">
              <li><Check size={14} /> File DNA generated</li>
              <li><Check size={14} /> Vault protected</li>
              <li><Check size={14} /> Provenance verified</li>
              <li><Check size={14} /> Authenticity checked</li>
              <li><Check size={14} /> Monitoring enabled</li>
            </ul>
          </div>

          <div className="glass-panel" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 8 }}>Listing summary</div>
            <div style={{ color: '#fff', fontSize: '0.9rem', lineHeight: 1.7 }}>
              <div>Category: {verticalLabel(listing?.vertical)}</div>
              <div>Creator: {listing?.creator_name || 'Verified creator'}</div>
              {listing?.asset_id && (
                <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                  Asset ref: {listing.asset_id}
                </div>
              )}
            </div>
          </div>

          {(human != null || ai != null) && (
            <div className="glass-panel" style={{ padding: 16 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 8 }}>
                Content assessment <span style={{ opacity: 0.7 }}>(detail view only)</span>
              </div>
              <div style={{ color: '#fff', fontSize: '0.9rem' }}>
                Human-authenticated signal: {human != null ? `${human}%` : '—'}
              </div>
              {ai != null && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                  AI content assessment: {ai}%
                </div>
              )}
              <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 10, lineHeight: 1.5 }}>
                Scores support creator authenticity labeling. They are not a legal warranty.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
