import React from 'react';
import { Store } from 'lucide-react';
import EmptyState from './EmptyState.jsx';

export default function BecomeSellerPanel({ onStart, busy }) {
  return (
    <div className="ex-page ex-page--narrow">
      <EmptyState
        icon={<Store size={28} color="var(--primary)" />}
        title="Sell your creative work"
        description="List Hub-protected assets on this same Pinit account. Buying stays as it is. No second account is required."
        primaryLabel={busy ? 'Please wait…' : 'Become a Seller'}
        onPrimary={busy ? undefined : onStart}
      />
    </div>
  );
}
