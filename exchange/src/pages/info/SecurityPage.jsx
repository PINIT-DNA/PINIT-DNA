import React from 'react';
import { ShieldCheck, Lock, Fingerprint, Eye, Server, Bell } from 'lucide-react';
import InfoPage, { InfoCards } from '../../components/InfoPage.jsx';

export default function SecurityPage({ onNavigate }) {
  return (
    <InfoPage
      onNavigate={onNavigate}
      crumbs={[{ label: 'Trust', page: 'trust' }, { label: 'Security' }]}
      eyebrow="Security"
      title="Security principles for Hub and Exchange"
      subtitle="Pinit HUB holds identity and vaulted files. Pinit Exchange handles discovery, licensing, and checkout. We do not claim SOC 2, ISO 27001, PCI, HIPAA, or GDPR certification on this page."
      related={[
        { page: 'enterprise', label: 'Enterprise', desc: 'Talk with the Pinit team' },
        { page: 'privacy', label: 'Privacy', desc: 'What information we collect' },
        { page: 'trust', label: 'Trust Center', desc: 'Protection and provenance' },
      ]}
      primaryCta={{ label: 'Contact enterprise', onClick: () => onNavigate?.('enterprise') }}
      secondaryCta={{ label: 'Read privacy', onClick: () => onNavigate?.('privacy') }}
    >
      <InfoCards
        items={[
          { icon: Fingerprint, title: 'Authentication', body: 'Exchange sign-in uses Pinit HUB biometric identity and a short-lived SSO token. Email/password is not accepted on Exchange.' },
          { icon: Lock, title: 'Asset protection', body: 'Originals are stored in the Hub vault. Marketplace cards show previews and license offers, not unprotected masters.' },
          { icon: ShieldCheck, title: 'Access control', body: 'Seller tools require a Hub-linked account. Buyer licenses are scoped to the purchasing identity.' },
          { icon: Server, title: 'Data protection', body: 'Sessions use the Hub JWT on Hub and an Exchange session keyed to Pinit ID. Secrets stay in server environment variables.' },
          { icon: Eye, title: 'Auditability', body: 'Listings, sealed sales, and Hub monitoring events form an operational trail for the account that owns them.' },
          { icon: Bell, title: 'Monitoring', body: 'After a license, Hub can continue watching for lookalike copies. Exchange surfaces seller alerts from that feed.' },
        ]}
      />

      <h2>Infrastructure and incidents</h2>
      <p>
        Production Hub and Exchange run on the project’s hosted backend, frontend, and database
        providers. Incident response is handled by the Pinit team. If you believe you found a
        security issue, use Creator Support or the enterprise contact form — do not post secrets
        or tokens in listings.
      </p>

      <h2>Privacy</h2>
      <p>
        Marketplace browsing can work as a guest. Accounts, checkout emails for receipts, and
        Hub identity are described on the Privacy page.
      </p>
    </InfoPage>
  );
}
