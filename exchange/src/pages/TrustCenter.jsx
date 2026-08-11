import React from 'react';
import { ShieldCheck, ArrowDown, Lock, Fingerprint, FileCheck, ShoppingBag, Eye, Activity } from 'lucide-react';

const STEPS = [
  {
    title: 'Creator uploads',
    body: 'Original creative work enters the Pinit ecosystem.',
    icon: Lock,
  },
  {
    title: 'Pinit HUB',
    body: 'Vault protection · Digital DNA · Provenance · Certificate',
    icon: Fingerprint,
  },
  {
    title: 'Pinit Exchange',
    body: 'Listing · License · Payment — commerce only',
    icon: ShoppingBag,
  },
  {
    title: 'Buyer',
    body: 'Licensed delivery after purchase authorization',
    icon: FileCheck,
  },
  {
    title: 'Pinit HUB',
    body: 'Monitoring · Verification · Evidence continues after sale',
    icon: Activity,
  },
];

export default function TrustCenter() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--emerald)', marginBottom: 12 }}>
          <ShieldCheck size={20} />
          <span style={{ fontWeight: 700 }}>Trust Center</span>
        </div>
        <h1 style={{ color: '#fff', fontSize: '2.2rem', marginBottom: 10 }}>Pinit Trust Architecture</h1>
        <p style={{ color: 'var(--text-muted)', maxWidth: 560, margin: '0 auto' }}>
          HUB protects the asset. Exchange monetizes the license. HUB keeps protecting after the transaction.
          Buyers see trust — not crypto internals.
        </p>
      </div>

      <div className="trust-flow">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <React.Fragment key={step.title + i}>
              <div className="glass-panel trust-flow__step">
                <Icon size={22} color="var(--primary)" />
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              {i < STEPS.length - 1 && (
                <div className="trust-flow__arrow">
                  <ArrowDown size={20} color="var(--text-dim)" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div className="glass-panel" style={{ padding: 24, marginTop: 40 }}>
        <h2 style={{ color: '#fff', marginBottom: 12 }}>Pinit Verified signals</h2>
        <div className="trust-signals">
          <div><strong>Protected</strong><span>Original secured in Hub vault</span></div>
          <div><strong>Provenance verified</strong><span>Traceable ownership history</span></div>
          <div><strong>Creator verified</strong><span>Seller identity linked via Hub when selling</span></div>
          <div><strong>Monitoring enabled</strong><span>Post-sale misuse watch in Hub</span></div>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: 16 }}>
          Optional Gold / Silver / Bronze labels summarize authenticity assessment for shoppers.
          Detailed scores appear only in the provenance drawer — not as primary marketplace claims.
        </p>
      </div>
    </div>
  );
}
