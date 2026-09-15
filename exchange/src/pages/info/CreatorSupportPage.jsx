import React, { useMemo, useState } from 'react';
import InfoPage, { FaqList } from '../../components/InfoPage.jsx';

const TOPICS = [
  { id: 'start', title: 'Getting started', body: 'Sign in with Hub biometric identity. Exchange will not accept email or password.' },
  { id: 'account', title: 'Account help', body: 'Your Exchange ID is PINIT-EX- plus the same code as your Hub account. Sign out from the header if you need to switch.' },
  { id: 'verify', title: 'Verification', body: 'Sellers must complete Hub biometric sign-in. Listings require a Hub-linked seller.' },
  { id: 'listing', title: 'Listing assets', body: 'Use List asset, then choose a file already in your Hub vault. Do not pick from computer folders.' },
  { id: 'license', title: 'Licensing', body: 'Buyers purchase a license, not automatic copyright. See the Licensing Guide and License Agreement.' },
  { id: 'pay', title: 'Payments', body: 'Checkout uses the configured Exchange payment flow. Sealed sales appear on the seller desk.' },
  { id: 'protect', title: 'Asset protection', body: 'Protect new files in Pinit HUB first. Then refresh the Hub vault picker on Exchange.' },
  { id: 'req', title: 'Requirements', body: 'Buyers post briefs. Creators submit Hub-protected work. Licensing closes on Exchange.' },
  { id: 'trouble', title: 'Troubleshooting', body: 'If Hub assets do not appear, confirm you signed in with the same Hub identity and click Refresh from Hub.' },
];

const FAQS = [
  { q: 'Why did Exchange open a computer folder?', a: 'That was a local file picker. Listing now shows Hub vault cards only. Protect new assets in Hub, then refresh.' },
  { q: 'Why is my Exchange ID different from Hub?', a: 'Same person, different prefix. Hub individual is PINIT-USER-CODE. Exchange is PINIT-EX-CODE.' },
  { q: 'Can I read these pages without signing in?', a: 'Yes. Sign-in is only required to list, buy, or open seller tools.' },
  { q: 'Where do I request a refund?', a: 'See the Refund Policy, then contact support from this page or your license record.' },
];

export default function CreatorSupportPage({ onNavigate }) {
  const [q, setQ] = useState('');
  const topics = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return TOPICS;
    return TOPICS.filter((t) => `${t.title} ${t.body}`.toLowerCase().includes(s));
  }, [q]);

  return (
    <InfoPage
      onNavigate={onNavigate}
      crumbs={[{ label: 'Business', page: 'sell' }, { label: 'Creator Support' }]}
      eyebrow="Creator Support"
      title="Get help listing, licensing, and protecting work"
      subtitle="Search common topics. Informational pages stay public. Actions like listing still require Hub sign-in."
      related={[
        { page: 'refund_policy', label: 'Refund Policy', desc: 'When a refund may apply' },
        { page: 'sell', label: 'Sell on Pinit', desc: 'Protect, list, earn' },
        { page: 'creator_program', label: 'Creator Program', desc: 'How joining works' },
      ]}
      primaryCta={{ label: 'Contact support', onClick: () => onNavigate?.('enterprise') }}
      secondaryCta={{ label: 'Open Licensing Guide', onClick: () => onNavigate?.('licensing_guide') }}
    >
      <label className="info-search" htmlFor="creator-support-search">
        <span className="visually-hidden">Search creator support</span>
        <input
          id="creator-support-search"
          type="search"
          className="form-input"
          placeholder="Search creator support..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      <div className="info-cards">
        {topics.length === 0 && (
          <p className="info-empty">No topics matched. Try “listing”, “Hub”, or “payments”.</p>
        )}
        {topics.map((t) => (
          <article key={t.id} className="info-card">
            <h3>{t.title}</h3>
            <p>{t.body}</p>
          </article>
        ))}
      </div>

      <h2>FAQ</h2>
      <FaqList items={FAQS} />
    </InfoPage>
  );
}
