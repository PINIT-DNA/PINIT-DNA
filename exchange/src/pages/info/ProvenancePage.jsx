import React from 'react';
import { ArrowDown } from 'lucide-react';
import InfoPage from '../../components/InfoPage.jsx';

const FLOW = [
  { title: 'Asset', body: 'The original creative asset the creator wants to license.' },
  { title: 'Pinit HUB', body: 'The file is protected in the Hub vault — not left as an open download.' },
  { title: 'Asset DNA', body: 'Hub records a digital identity for the asset so later copies can be compared.' },
  { title: 'Protection', body: 'Access, sharing, and delivery stay under Hub controls.' },
  { title: 'Provenance', body: 'A history of who protected it and how it has been handled.' },
  { title: 'Exchange listing', body: 'A public license offer appears on the marketplace.' },
  { title: 'License', body: 'Checkout creates a sealed record of what the buyer may use.' },
  { title: 'Evidence', body: 'Hub can keep monitoring and retain an audit trail after the sale.' },
];

export default function ProvenancePage({ onNavigate }) {
  return (
    <InfoPage
      onNavigate={onNavigate}
      crumbs={[{ label: 'Trust', page: 'trust' }, { label: 'Provenance' }]}
      eyebrow="Provenance"
      title="Every protected asset can carry a verifiable digital identity"
      subtitle="Provenance is the story of the file — from Hub protection to the license a buyer receives. Exchange sells the license. Hub keeps the evidence trail."
      related={[
        { page: 'trust', label: 'Trust Center', desc: 'How Hub and Exchange work together' },
        { page: 'security', label: 'Security', desc: 'Access, encryption, and privacy' },
        { page: 'licensing_guide', label: 'Licensing Guide', desc: 'What a purchase grants' },
      ]}
      primaryCta={{ label: 'Learn about asset protection', onClick: () => onNavigate?.('trust') }}
      secondaryCta={{ label: 'Open marketplace', onClick: () => onNavigate?.('marketplace') }}
    >
      <h2>Lifecycle</h2>
      <ol className="info-flow">
        {FLOW.map((step, i) => (
          <li key={step.title}>
            <div className="info-flow__card">
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
            {i < FLOW.length - 1 && (
              <div className="info-flow__arrow" aria-hidden>
                <ArrowDown size={16} />
              </div>
            )}
          </li>
        ))}
      </ol>

      <h2>Words we use</h2>
      <dl className="info-dl">
        <div><dt>Asset DNA</dt><dd>A digital fingerprint Hub derives from the protected asset.</dd></div>
        <div><dt>Verification</dt><dd>Signals that the listing is tied to a Hub-protected original.</dd></div>
        <div><dt>Ownership evidence</dt><dd>Records that help show who protected the work and when.</dd></div>
        <div><dt>Monitoring</dt><dd>After a sale, Hub can keep watching for copies that look like the original.</dd></div>
        <div><dt>Audit trail</dt><dd>A history of protection, listing, and license events — not a public dump of vault contents.</dd></div>
      </dl>
    </InfoPage>
  );
}
