import React from 'react';
import { ShoppingBag } from 'lucide-react';
import EmptyState from './EmptyState.jsx';

export default function BecomeBuyerPanel({ onEnable, busy }) {
  return (
    <div className="ex-page ex-page--narrow">
      <EmptyState
        icon={<ShoppingBag size={28} color="var(--primary)" />}
        title="Buy creative work"
        description="You already sell on Pinit Exchange. You can also buy creative work from other creators using the same Pinit account. No second account is required."
        primaryLabel={busy ? 'Please wait…' : 'Become a Buyer'}
        onPrimary={busy ? undefined : onEnable}
      />
    </div>
  );
}
