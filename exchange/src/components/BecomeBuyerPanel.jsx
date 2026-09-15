import React from 'react';
import { ShoppingBag } from 'lucide-react';
import EmptyState from './EmptyState.jsx';

export default function BecomeBuyerPanel({ onEnable, busy }) {
  return (
    <div className="ex-page ex-page--narrow">
      <EmptyState
        icon={<ShoppingBag size={28} color="var(--primary)" />}
        title="Want to buy creative work?"
        description="You can buy from other creators using your existing Pinit account. No second account is required."
        primaryLabel={busy ? 'Please wait…' : 'Become a Buyer'}
        onPrimary={busy ? undefined : onEnable}
      />
    </div>
  );
}
