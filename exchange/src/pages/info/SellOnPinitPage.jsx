import React from 'react';
import { ShieldCheck, ShoppingBag, CheckCircle, Activity } from 'lucide-react';
import InfoPage, { InfoCards, InfoSteps } from '../../components/InfoPage.jsx';

export default function SellOnPinitPage({ onNavigate, onOpenAuth, onOpenListFromHub, user }) {
  const list = () => {
    if (user && Number(user.hub_linked) && user.role !== 'buyer' && user.exchange_role !== 'buyer') {
      onOpenListFromHub?.();
      return;
    }
    if (user?.role === 'buyer' || user?.exchange_role === 'buyer') {
      onOpenAuth?.({ mode: 'signup', intent: 'creator' });
      return;
    }
    onOpenAuth?.({ mode: 'signup', intent: 'creator' });
  };

  return (
    <InfoPage
      onNavigate={onNavigate}
      crumbs={[{ label: 'Business', page: 'enterprise' }, { label: 'Sell on Pinit' }]}
      eyebrow="Sell on Pinit"
      title="Turn your creative work into revenue"
      subtitle="Create. Protect. List. License. Earn. Hub keeps the original safe. Exchange is where buyers find and license it."
      related={[
        { page: 'creator_program', label: 'Creator Program', desc: 'Who can join and how' },
        { page: 'marketplace', label: 'Marketplace', desc: 'See how listings appear' },
        { page: 'trust', label: 'Pinit HUB protection', desc: 'Vault, DNA, monitoring' },
      ]}
      primaryCta={{ label: 'List an asset', onClick: list }}
      secondaryCta={{ label: 'Learn about Creator Program', onClick: () => onNavigate?.('creator_program') }}
    >
      <InfoSteps
        steps={[
          { title: 'Protect your asset with Pinit HUB', body: 'Upload in Hub so the file gets vault protection and Asset DNA before it is offered for sale.' },
          { title: 'Create your marketplace listing', body: 'On Exchange, pick the Hub asset. Set title, category, and license prices.' },
          { title: 'Set licensing and pricing', body: 'Offer personal, commercial, exclusive, or enterprise terms that match how you want the work used.' },
          { title: 'Reach buyers', body: 'Published listings appear in Discover with Hub verified signals.' },
          { title: 'Complete secure transactions', body: 'Checkout on Exchange records the license. Delivery stays authorized through Hub.' },
          { title: 'Track performance', body: 'Seller overview shows listings, sealed sales, and Hub monitoring alerts.' },
        ]}
      />

      <h2>Why sell here</h2>
      <InfoCards
        items={[
          { icon: CheckCircle, title: 'Verified creator identity', body: 'Same face, same Pinit code — Exchange account is PINIT-EX- plus that code.' },
          { icon: ShieldCheck, title: 'Protected assets', body: 'You list a license. The master stays in Hub.' },
          { icon: ShoppingBag, title: 'Marketplace visibility', body: 'Discover, collections, and requirements put protected work in front of buyers.' },
          { icon: Activity, title: 'Sales analytics', body: 'See listings, licenses sold, and Hub alerts from the seller desk.' },
        ]}
      />
    </InfoPage>
  );
}
