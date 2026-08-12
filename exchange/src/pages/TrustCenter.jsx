import React from 'react';
import { ShieldCheck, ArrowDown, Lock, Fingerprint, FileCheck, ShoppingBag, Eye, Activity, Users } from 'lucide-react';
import InfoPage, { InfoCards } from '../components/InfoPage.jsx';

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

export default function TrustCenter({ onNavigate }) {
  return (
    <InfoPage
      onNavigate={onNavigate}
      crumbs={[{ label: 'Trust', page: 'trust' }, { label: 'Trust Center' }]}
      eyebrow="Trust Center"
      title="Trust is built into every asset"
      subtitle="Pinit Exchange combines marketplace commerce with Pinit HUB protection, provenance and verification. Hub protects. Exchange monetizes. Hub keeps protecting after the sale."
      related={[
        { page: 'security', label: 'Security', desc: 'Access, encryption, privacy' },
        { page: 'provenance', label: 'Provenance', desc: 'Asset DNA and evidence' },
        { page: 'licensing_guide', label: 'Licensing Guide', desc: 'What a purchase grants' },
      ]}
      primaryCta={{ label: 'Learn how Pinit protects assets', onClick: () => onNavigate?.('provenance') }}
      secondaryCta={{ label: 'Explore assets', onClick: () => onNavigate?.('marketplace') }}
    >
      <InfoCards
        items={[
          { icon: Users, title: 'Verified creators', body: 'Sellers sign in with Hub biometric identity. Exchange IDs share the same core code.' },
          { icon: Lock, title: 'Protected assets', body: 'Masters stay in the Hub vault. Shoppers see previews and license offers.' },
          { icon: Fingerprint, title: 'Provenance', body: 'Asset DNA and history help show where the protected file came from.' },
          { icon: FileCheck, title: 'Licensing transparency', body: 'Personal, commercial, exclusive, and enterprise tiers are explained before checkout.' },
          { icon: Eye, title: 'Monitoring', body: 'After a sale, Hub can keep watching for copies that look like the original.' },
          { icon: ShieldCheck, title: 'Evidence', body: 'Sealed licenses and Hub records form an audit trail for that asset.' },
        ]}
      />

      <h2>How Hub and Exchange work together</h2>
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

      <div className="glass-panel" style={{ padding: 24, marginTop: 28 }}>
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
    </InfoPage>
  );
}
