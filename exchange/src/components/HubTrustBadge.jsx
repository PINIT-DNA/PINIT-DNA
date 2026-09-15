import React from 'react';
import { ShieldCheck, Check } from 'lucide-react';

/**
 * Persistent buyer-facing trust signal — no crypto internals.
 */
export default function HubTrustBadge({
  compact = false,
  onOpenProvenance,
  style = {},
}) {
  if (compact) {
    return (
      <button
        type="button"
        className="hub-trust-compact"
        onClick={onOpenProvenance}
        style={style}
        title="Protected by Pinit HUB"
      >
        <ShieldCheck size={12} />
        HUB Protected
      </button>
    );
  }

  return (
    <div className="hub-trust-card" style={style}>
      <div className="hub-trust-card__head">
        <ShieldCheck size={18} color="var(--emerald)" />
        <strong>Protected by Pinit HUB</strong>
      </div>
      <ul className="hub-trust-card__list">
        <li><Check size={14} /> HUB Protected</li>
        <li><Check size={14} /> Verified</li>
        <li><Check size={14} /> Authenticity available</li>
      </ul>
      <p className="hub-trust-card__note">
        Protection and provenance information are available for this asset.
      </p>
      {onOpenProvenance && (
        <button type="button" className="btn-secondary" style={{ marginTop: 10, width: '100%' }} onClick={onOpenProvenance}>
          View provenance
        </button>
      )}
    </div>
  );
}
