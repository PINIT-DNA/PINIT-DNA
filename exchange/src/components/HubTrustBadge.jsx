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
        title="HUB Verified & Protected — view provenance"
      >
        <ShieldCheck size={12} />
        HUB Verified &amp; Protected
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
        <li><Check size={14} /> Vault protected</li>
        <li><Check size={14} /> Digital DNA registered</li>
        <li><Check size={14} /> Provenance verified</li>
        <li><Check size={14} /> Monitoring enabled</li>
      </ul>
      {onOpenProvenance && (
        <button type="button" className="btn-secondary" style={{ marginTop: 10, width: '100%' }} onClick={onOpenProvenance}>
          View provenance
        </button>
      )}
    </div>
  );
}
