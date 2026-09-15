import React, { useEffect, useState } from 'react';
import InfoPage from '../../components/InfoPage.jsx';

const UPDATED = '11 August 2026';

function LegalLayout({ crumbs, title, subtitle, onNavigate, related, primaryCta, secondaryCta, sections }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    setActive(sections[0]?.id);
  }, [title]);

  const jump = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <InfoPage
      onNavigate={onNavigate}
      crumbs={crumbs}
      eyebrow="Legal"
      title={title}
      subtitle={subtitle}
      related={related}
      primaryCta={primaryCta}
      secondaryCta={secondaryCta}
    >
      <p className="info-updated">Last updated: {UPDATED}</p>
      <div className="legal-layout">
        <nav className="legal-nav" aria-label="On this page">
          <p className="legal-nav__label">On this page</p>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={active === s.id ? 'is-active' : ''}
              onClick={() => jump(s.id)}
            >
              {s.heading}
            </button>
          ))}
        </nav>
        <div className="legal-content">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="legal-section">
              <h2>{s.heading}</h2>
              {s.body}
            </section>
          ))}
        </div>
      </div>
    </InfoPage>
  );
}

export function TermsPage({ onNavigate }) {
  return (
    <LegalLayout
      onNavigate={onNavigate}
      crumbs={[{ label: 'Legal', page: 'terms' }, { label: 'Terms' }]}
      title="Terms of use"
      subtitle="These terms describe how to use Pinit Exchange. They are a product summary for this application, not a substitute for advice from your counsel."
      related={[
        { page: 'privacy', label: 'Privacy', desc: 'Information we collect' },
        { page: 'license_agreement', label: 'License Agreement', desc: 'What a purchase grants' },
      ]}
      primaryCta={{ label: 'Browse marketplace', onClick: () => onNavigate?.('marketplace') }}
      sections={[
        { id: 'intro', heading: 'Introduction', body: <p>Pinit Exchange is the marketplace where people discover and license creative work. Pinit HUB provides identity, vault protection, and monitoring.</p> },
        { id: 'account', heading: 'Account responsibilities', body: <p>You must use Hub biometric sign-in for an Exchange account. Keep your Hub session secure. Do not share SSO tokens.</p> },
        { id: 'usage', heading: 'Marketplace usage', body: <p>Use Exchange to browse, brief, list, and license. Do not scrape listings or interfere with checkout.</p> },
        { id: 'creators', heading: 'Creator responsibilities', body: <p>Only list work you have the right to license. Protect the original in Hub before publishing. Pricing and license type must match what you intend to grant.</p> },
        { id: 'buyers', heading: 'Buyer responsibilities', body: <p>Use licensed files only as the listing and checkout allow. Do not treat a license as a copyright transfer unless that is stated.</p> },
        { id: 'listings', heading: 'Listings', body: <p>Listings must describe the Hub-protected asset honestly. Exchange may remove listings that violate these terms or Hub policy (including high-AI blocks already enforced by the product).</p> },
        { id: 'tx', heading: 'Transactions', body: <p>Checkout creates a sealed license record. Delivery is authorized through Hub. Taxes and processor fees follow the payment provider configured for this deployment.</p> },
        { id: 'prohibited', heading: 'Prohibited activity', body: <p>No stolen work, malware, impersonation, or attempts to bypass Hub protection or Exchange payments.</p> },
        { id: 'ip', heading: 'Intellectual property', body: <p>Creators keep copyright unless a listing says otherwise. Pinit branding stays with Pinit.</p> },
        { id: 'suspend', heading: 'Suspension / termination', body: <p>Pinit may suspend accounts that abuse the marketplace or Hub identity. You may stop using Exchange by signing out and ceasing listings.</p> },
        { id: 'disclaimer', heading: 'Disclaimers', body: <p>Exchange is provided as implemented in this product. We do not warrant uninterrupted service or that every listing is free of third-party claims.</p> },
        { id: 'liability', heading: 'Limitation of liability', body: <p>To the extent allowed by law, Pinit is not liable for indirect losses from marketplace use. Specific enterprise terms, if signed separately, control for those deals.</p> },
        { id: 'changes', heading: 'Changes', body: <p>We may update these terms as the product changes. The date above shows the latest revision in this app.</p> },
      ]}
    />
  );
}

export function PrivacyPage({ onNavigate }) {
  return (
    <LegalLayout
      onNavigate={onNavigate}
      crumbs={[{ label: 'Legal', page: 'privacy' }, { label: 'Privacy' }]}
      title="Privacy"
      subtitle="This describes practices implemented in the current Pinit Exchange and Hub integration — not certifications we do not hold."
      related={[
        { page: 'security', label: 'Security', desc: 'How access is designed' },
        { page: 'terms', label: 'Terms', desc: 'Marketplace rules' },
      ]}
      sections={[
        { id: 'collect', heading: 'Information collected', body: <p>Hub identity (Pinit ID, name, email Hub already stores), Exchange role, listings you publish, cart and license records, and optional receipt email at checkout. Guests may have a local cart key in the browser.</p> },
        { id: 'use', heading: 'How information is used', body: <p>To sign you in via Hub SSO, show your listings and licenses, complete checkout, and load Hub vault assets you choose to list.</p> },
        { id: 'share', heading: 'Data sharing', body: <p>Exchange calls Hub with a bridge secret on the server to list vault assets and complete SSO. Payment data is handled by the configured processor (for example Razorpay when enabled). We do not sell listing personal data as a product.</p> },
        { id: 'security', heading: 'Security', body: <p>See the Security page. Vault files stay in Hub storage. Exchange stores marketplace records in its database schema.</p> },
        { id: 'cookies', heading: 'Cookies', body: <p>Session is stored in the browser (localStorage for Exchange session; Hub JWT on Hub). We do not add a separate advertising cookie stack on these pages.</p> },
        { id: 'rights', heading: 'User rights', body: <p>You can sign out anytime. To correct Hub profile data, use Hub settings. For Exchange listing or license questions, use Creator Support.</p> },
        { id: 'retain', heading: 'Data retention', body: <p>Account, listing, and sealed license records remain so licenses can be verified. Guest cart keys stay in the local browser until cleared.</p> },
        { id: 'third', heading: 'Third-party services', body: <p>Hosting, database, storage, and payments are the providers already configured for this project. Preview images on demo collection cards may load from the image host used in those samples.</p> },
        { id: 'contact', heading: 'Contact', body: <p>Use Creator Support or the enterprise contact form. Do not send passwords or vault keys.</p> },
      ]}
    />
  );
}

export function LicenseAgreementPage({ onNavigate }) {
  return (
    <LegalLayout
      onNavigate={onNavigate}
      crumbs={[{ label: 'Legal', page: 'license_agreement' }, { label: 'License Agreement' }]}
      title="License agreement"
      subtitle="Purchasing a license does not necessarily transfer copyright ownership. The listing and checkout terms control the grant."
      related={[
        { page: 'licensing_guide', label: 'Licensing Guide', desc: 'Plain-language comparison' },
        { page: 'marketplace', label: 'Marketplace', desc: 'See live listings' },
      ]}
      primaryCta={{ label: 'Browse licensed assets', onClick: () => onNavigate?.('marketplace') }}
      sections={[
        { id: 'grant', heading: 'License grant', body: <p>When checkout completes, the buyer receives a non-exclusive license unless the listing is exclusive or enterprise and checkout states that scope.</p> },
        { id: 'permit', heading: 'Permitted use', body: <p>Use the files for the media, seats, and purpose shown on the listing (personal, commercial, exclusive, or enterprise).</p> },
        { id: 'restrict', heading: 'Restrictions', body: <p>Do not resell the asset as stock, remove required notices, or exceed the purchased tier. Do not attempt to extract unprotected masters from Hub.</p> },
        { id: 'commercial', heading: 'Commercial use', body: <p>Commercial and enterprise tiers allow monetized use as described at purchase. Personal tier does not.</p> },
        { id: 'own', heading: 'Ownership', body: <p>Copyright stays with the creator unless the parties agree otherwise in writing on that listing.</p> },
        { id: 'attr', heading: 'Attribution', body: <p>Follow any credit line the listing requires. If none is stated, credit is appreciated but not invented as a legal duty here.</p> },
        { id: 'end', heading: 'Termination', body: <p>Misuse can revoke the license. Refunds, if any, follow the Refund Policy and do not automatically restore a revoked exclusive listing.</p> },
        { id: 'disputes', heading: 'Disputes', body: <p>Ownership disputes should be raised through Creator Support with the listing and Hub asset ID. Exchange records and Hub provenance help review the claim.</p> },
      ]}
    />
  );
}

export function RefundPolicyPage({ onNavigate }) {
  return (
    <LegalLayout
      onNavigate={onNavigate}
      crumbs={[{ label: 'Legal', page: 'refund_policy' }, { label: 'Refund Policy' }]}
      title="Refund policy"
      subtitle="Digital licenses are generally final once delivered. We review eligible cases below. We do not promise an automatic refund or a fixed number of hours."
      related={[
        { page: 'creator_support', label: 'Creator Support', desc: 'How to get help' },
        { page: 'license_agreement', label: 'License Agreement', desc: 'What you purchased' },
      ]}
      primaryCta={{ label: 'Request support', onClick: () => onNavigate?.('creator_support') }}
      sections={[
        { id: 'before', heading: 'Before purchase', body: <p>Read the license type, preview, and Hub verification signals. Personal vs commercial vs exclusive is shown on the listing.</p> },
        { id: 'after', heading: 'After purchase', body: <p>You receive a sealed license and authorized delivery. Changing your mind after a successful download is usually not refundable.</p> },
        { id: 'eligible', heading: 'Eligible refunds', body: <p>We may review: duplicate charges, a file that cannot be delivered because of a confirmed technical fault on our side, or an unauthorized payment you report promptly.</p> },
        { id: 'not', heading: 'Non-refundable situations', body: <p>Wrong license tier chosen, creative preference after seeing the preview, or use that already started under the license.</p> },
        { id: 'dup', heading: 'Duplicate purchases', body: <p>If checkout ran twice for the same listing, contact support with both order or seal IDs.</p> },
        { id: 'tech', heading: 'Technical problems', body: <p>If licensed delivery fails, try Hub/Exchange sign-in again, then request support with the listing ID.</p> },
        { id: 'unauth', heading: 'Unauthorized transactions', body: <p>Report suspected unauthorized checkout immediately through Creator Support so we can review the payment record.</p> },
        { id: 'how', heading: 'How to request a refund', body: <p>Open Creator Support, include your Pinit ID, listing ID, and seal or order ID if you have one. Do not send card numbers in the form.</p> },
        { id: 'review', heading: 'Review process', body: <p>The team reviews Exchange records and, if needed, Hub delivery status. Outcome depends on the facts of that purchase.</p> },
        { id: 'time', heading: 'Expected response', body: <p>We aim to acknowledge support requests during normal working days. Timing is not a service-level guarantee in this policy.</p> },
      ]}
    />
  );
}

export function NotFoundPage({ onNavigate }) {
  return (
    <InfoPage
      onNavigate={onNavigate}
      crumbs={[{ label: 'Page not found' }]}
      eyebrow="404"
      title="This page is not on Exchange"
      subtitle="The link may be outdated. Use the footer or go back to Discover."
      primaryCta={{ label: 'Explore assets', onClick: () => onNavigate?.('marketplace') }}
      secondaryCta={{ label: 'Home', onClick: () => onNavigate?.('home') }}
    >
      <p>Every footer destination is a real page. If you typed a URL, check for a typo.</p>
    </InfoPage>
  );
}
