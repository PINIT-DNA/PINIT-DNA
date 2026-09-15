import React from 'react';
import { CreditCard, ShieldCheck, Lock } from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';

export default function BuyerPayments({ onNavigate }) {
  return (
    <StudioPage
      title="Payment methods"
      subtitle="Cards are tokenized by the payment provider. Pinit Exchange never stores raw card numbers."
    >
      <div className="glass-panel" style={{ padding: 28, maxWidth: 640 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <ShieldCheck size={22} color="var(--emerald)" />
          <strong style={{ color: '#fff', fontSize: '1.05rem' }}>Provider-hosted checkout</strong>
        </div>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 18 }}>
          When you license an asset, checkout opens with the payment processor. Saved methods, if any,
          live with that provider. Exchange only keeps a payment intent id and order status.
        </p>
        <ul className="studio-activity" style={{ marginBottom: 20 }}>
          <li><Lock size={14} /> No raw PAN / CVV stored in Exchange or Hub</li>
          <li><CreditCard size={14} /> Mock or live processor is configured on the server</li>
          <li><ShieldCheck size={14} /> License seals after a successful payment confirmation</li>
        </ul>
        <button type="button" className="btn-primary" onClick={() => onNavigate?.('cart')}>
          Go to cart
        </button>
      </div>
    </StudioPage>
  );
}
