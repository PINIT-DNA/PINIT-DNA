import React from 'react';
import { User, ShieldCheck, ShoppingBag, DollarSign } from 'lucide-react';
import InfoPage, { InfoCards, InfoSteps } from '../../components/InfoPage.jsx';

export default function CreatorProgramPage({ onNavigate, onOpenAuth }) {
  return (
    <InfoPage
      onNavigate={onNavigate}
      crumbs={[{ label: 'Product', page: 'marketplace' }, { label: 'Creator Program' }]}
      eyebrow="Creator Program"
      title="Join Pinit Exchange as a creator"
      subtitle="One Hub identity. Protect your work, list licenses, and earn — without giving up the files that stay in your vault."
      related={[
        { page: 'sell', label: 'Sell on Pinit', desc: 'Protect, list, and reach buyers' },
        { page: 'creator_support', label: 'Creator Support', desc: 'Listings, payments, and Hub help' },
        { page: 'passports', label: 'Creators', desc: 'See creator passports' },
      ]}
      primaryCta={{ label: 'Become a creator', onClick: () => onOpenAuth?.({ mode: 'signup', intent: 'creator' }) }}
      secondaryCta={{ label: 'View creator guidelines', onClick: () => onNavigate?.('licensing_guide') }}
    >
      <h2>Who can become a creator</h2>
      <p>
        Anyone with original work they have the right to license — photographers, filmmakers,
        designers, illustrators, studios — can sell on Exchange after signing in with Pinit HUB
        biometric identity.
      </p>

      <InfoCards
        items={[
          { icon: User, title: 'Verification', body: 'Your Exchange seller account is tied to the same Hub identity used to protect files.' },
          { icon: ShieldCheck, title: 'HUB protection', body: 'Masters stay in the Hub vault. Exchange lists a license, not an unprotected original.' },
          { icon: ShoppingBag, title: 'Listing', body: 'Choose a protected asset, set license prices, and publish to Discover.' },
          { icon: DollarSign, title: 'Payments', body: 'Buyers complete checkout on Exchange. Delivery and monitoring stay with Hub.' },
        ]}
      />

      <h2>How it works</h2>
      <InfoSteps
        steps={[
          { title: 'Create a Hub account', body: 'Sign in with Hub biometric identity. Exchange uses PINIT-EX- plus your shared ID.' },
          { title: 'Protect the file', body: 'Upload in Pinit HUB so the asset receives vault protection and Asset DNA.' },
          { title: 'List on Exchange', body: 'Pick the Hub asset, set personal / commercial / exclusive pricing, and publish.' },
          { title: 'License and deliver', body: 'When a buyer licenses the work, Exchange records the sale and Hub handles protected delivery.' },
          { title: 'Reputation and analytics', body: 'Seller overview shows listings, sealed sales, and Hub monitoring alerts.' },
        ]}
      />

      <h2>Support</h2>
      <p>
        Listing issues, payouts, and protection questions are covered in Creator Support.
        For product how-to, start with the Licensing Guide.
      </p>
    </InfoPage>
  );
}
