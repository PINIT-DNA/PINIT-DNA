import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar.jsx';
import ListFromHubModal from './components/ListFromHubModal.jsx';
import CheckoutModal from './components/CheckoutModal.jsx';
import AuthModal, { SESSION_KEY } from './components/AuthModal.jsx';

import HomePage from './pages/HomePage.jsx';
import Marketplace from './pages/Marketplace.jsx';
import ListingDetail from './pages/ListingDetail.jsx';
import Collections from './pages/Collections.jsx';
import RequirementsExchange from './pages/RequirementsExchange.jsx';
import CreatorPassports from './pages/CreatorPassports.jsx';
import EnterpriseLicensing from './pages/EnterpriseLicensing.jsx';
import TrustCenter from './pages/TrustCenter.jsx';
import KnowledgeGuide from './pages/KnowledgeGuide.jsx';
import MyLicenses from './pages/MyLicenses.jsx';
import CreatorDesk from './pages/CreatorDesk.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import CartPage from './pages/CartPage.jsx';
import WishlistPage from './pages/WishlistPage.jsx';
import SiteFooter from './components/SiteFooter.jsx';
import { apiFetch } from './lib/api.js';
import { buyerKey } from './lib/buyer.js';

const HUB_APP_URL = (import.meta.env.VITE_HUB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function App() {
  const [activePage, setActivePage] = useState('home');

  const [selectedListingId, setSelectedListingId] = useState(null);
  const [checkoutListing, setCheckoutListing] = useState(null);
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [preselectedAssetId, setPreselectedAssetId] = useState(null);
  const [focusListingId, setFocusListingId] = useState(null);
  const [marketplaceResetToken, setMarketplaceResetToken] = useState(0);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('welcome');
  const [authIntent, setAuthIntent] = useState(null);
  const [user, setUser] = useState(null);
  const [cartCount, setCartCount] = useState(0);

  const refreshCartCount = async () => {
    const key = buyerKey(user) || localStorage.getItem('pinit_guest_buyer');
    if (!key) {
      setCartCount(0);
      return;
    }
    const { ok, data } = await apiFetch(`/api/commerce/cart?buyer_key=${encodeURIComponent(key)}`);
    if (ok) setCartCount(data.count || 0);
  };

  useEffect(() => {
    restoreSession();
    handleHubHandoff();
  }, []);

  useEffect(() => {
    refreshCartCount();
  }, [user?.pinit_id, user?.email]);

  const openAuth = ({ mode = 'welcome', intent = null } = {}) => {
    setAuthMode(mode);
    setAuthIntent(intent);
    setAuthOpen(true);
  };

  const handleSignOut = () => {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
    setActivePage('home');
  };

  const saveSession = (u) => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        pinit_id: u.pinit_id,
        exchange_id: u.exchange_id,
        role: u.role,
        at: Date.now(),
      }),
    );
  };

  const restoreSession = async () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const session = JSON.parse(raw);
      if (!session?.pinit_id) return;
      const res = await fetch(`/api/auth/me?pinit_id=${encodeURIComponent(session.pinit_id)}`);
      if (res.ok) setUser(await res.json());
      else localStorage.removeItem(SESSION_KEY);
    } catch (err) {
      console.error('Session restore failed:', err);
    }
  };

  const handleHubHandoff = async () => {
    try {
      const params = new URLSearchParams(window.location.search);
      const hubSso = params.get('hub_sso');
      const hubList = params.get('hub_list');

      if (hubSso) {
        const res = await fetch('/api/auth/hub-sso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: hubSso }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setUser(data.user);
            saveSession(data.user);
            setActivePage('creator_desk');
          }
        }
      }

      if (hubList) {
        const res = await fetch('/api/listings/from-hub', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hub_list_token: hubList }),
        });
        if (res.ok) {
          const data = await res.json();
          sessionStorage.setItem('pinit_hub_list_token', hubList);
          if (data.asset?.pinit_id) {
            try {
              const me = await fetch(`/api/auth/me?pinit_id=${encodeURIComponent(data.asset.pinit_id)}`);
              if (me.ok) {
                const u = await me.json();
                setUser(u);
                saveSession(u);
              } else {
                setUser((prev) => ({
                  ...(prev || {}),
                  pinit_id: data.asset.pinit_id,
                  name: prev?.name || 'Pinit Creator',
                  role: 'creator',
                  hub_linked: 1,
                }));
              }
            } catch {
              setUser((prev) => ({
                ...(prev || {}),
                pinit_id: data.asset.pinit_id,
                role: 'creator',
                hub_linked: 1,
              }));
            }
          }
          setPreselectedAssetId(data.asset?.asset_id || data.intent?.asset_id || null);
          setIsListModalOpen(true);
          setActivePage('marketplace');
          setMarketplaceResetToken((n) => n + 1);
        }
      }

      if (hubSso || hubList) {
        const url = new URL(window.location.href);
        url.searchParams.delete('hub_sso');
        url.searchParams.delete('hub_list');
        url.searchParams.delete('vault_id');
        url.searchParams.delete('hub_return');
        window.history.replaceState({}, '', url.pathname + url.search);
      }
    } catch (err) {
      console.error('Hub handoff failed:', err);
    }
  };

  const openListFromHub = () => {
    if (!user) {
      openAuth({ mode: 'signup', intent: 'creator' });
      return;
    }
    if (user.role === 'buyer' || !Number(user.hub_linked)) {
      openAuth({ mode: 'signup', intent: 'creator' });
      return;
    }
    setIsListModalOpen(true);
  };

  const requireUser = (intent, action) => {
    if (!user) {
      openAuth({ mode: intent ? 'signup' : 'welcome', intent: intent || null });
      return;
    }
    if (intent === 'creator' && (user.role === 'buyer' || !Number(user.hub_linked))) {
      openAuth({ mode: 'signup', intent: 'creator' });
      return;
    }
    action?.();
  };

  const handleSelectListing = (id) => {
    setSelectedListingId(id);
    setActivePage('listing_detail');
  };

  const handleOpenCheckout = (listing) => {
    requireUser('buyer', () => {
      setCheckoutListing(listing);
      setIsCheckoutModalOpen(true);
    });
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#080b11',
        color: '#f8fafc',
      }}
    >
      <Navbar
        activePage={activePage}
        setActivePage={setActivePage}
        onOpenListFromHub={openListFromHub}
        onOpenAuth={openAuth}
        onSignOut={handleSignOut}
        user={user}
        cartCount={cartCount}
      />

      <main style={{ flex: 1 }}>
        {activePage === 'home' && (
          <HomePage
            onNavigate={(page) => setActivePage(page)}
            onOpenListFromHub={openListFromHub}
            onOpenAuth={openAuth}
            user={user}
            onSelectListing={handleSelectListing}
          />
        )}

            {activePage === 'marketplace' && (
              <Marketplace
                onSelectListing={handleSelectListing}
                onOpenListFromHub={openListFromHub}
                user={user}
                focusListingId={focusListingId}
                resetFiltersToken={marketplaceResetToken}
              />
            )}

        {activePage === 'listing_detail' && (
          <ListingDetail
            listingId={selectedListingId}
            onBack={() => setActivePage('marketplace')}
            onOpenCheckout={handleOpenCheckout}
            user={user}
            onCartChanged={refreshCartCount}
          />
        )}

        {activePage === 'cart' && (
          <CartPage
            user={user}
            onOpenAuth={openAuth}
            onSelectListing={handleSelectListing}
            onBrowse={(page) => setActivePage(page || 'marketplace')}
            onCheckoutDone={() => {
              refreshCartCount();
              setActivePage('my_licenses');
            }}
          />
        )}

        {activePage === 'wishlist' && (
          <WishlistPage
            user={user}
            onOpenAuth={openAuth}
            onSelectListing={handleSelectListing}
            onBrowse={(page) => setActivePage(page || 'marketplace')}
            onAddToCart={async (listing) => {
              const key = buyerKey(user) || localStorage.getItem('pinit_guest_buyer') || `GUEST-${Date.now()}`;
              if (!localStorage.getItem('pinit_guest_buyer') && !user) {
                localStorage.setItem('pinit_guest_buyer', key);
              }
              await fetch('/api/commerce/cart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  buyer_key: key,
                  listing_id: listing.listing_id,
                  license_tier: 'commercial',
                }),
              });
              refreshCartCount();
              setActivePage('cart');
            }}
          />
        )}

        {activePage === 'collections' && (
          <Collections
            onSelectListing={handleSelectListing}
            onNavigateMarketplace={() => setActivePage('marketplace')}
          />
        )}
        {activePage === 'requirements' && (
          <RequirementsExchange onNavigate={(page) => setActivePage(page)} />
        )}
        {activePage === 'passports' && (
          <CreatorPassports
            user={user}
            onNavigate={(page) => setActivePage(page)}
            onOpenAuth={openAuth}
          />
        )}
        {activePage === 'enterprise' && <EnterpriseLicensing />}
        {activePage === 'trust' && <TrustCenter />}
        {activePage === 'knowledge' && <KnowledgeGuide />}

        {activePage === 'my_licenses' && (
          <MyLicenses
            user={user}
            onViewCertificate={(sealId) => alert(`Certificate ${sealId} verified tamper-proof.`)}
          />
        )}

        {activePage === 'creator_desk' && (
          <CreatorDesk
            user={user}
            onOpenListFromHub={openListFromHub}
            onOpenAuth={openAuth}
            hubAppUrl={HUB_APP_URL}
          />
        )}

        {activePage === 'settings' && (
          <SettingsPage user={user} onUserUpdated={(updated) => setUser(updated)} />
        )}
      </main>

      <ListFromHubModal
        isOpen={isListModalOpen}
        onClose={() => {
          setIsListModalOpen(false);
          setPreselectedAssetId(null);
        }}
        onListingCreated={(listing) => {
          setIsListModalOpen(false);
          setPreselectedAssetId(null);
          setFocusListingId(listing?.listing_id || null);
          setMarketplaceResetToken((n) => n + 1);
          setActivePage('marketplace');
        }}
        user={user}
        preselectedAssetId={preselectedAssetId}
        hubAppUrl={HUB_APP_URL}
      />

      <CheckoutModal
        isOpen={isCheckoutModalOpen}
        onClose={() => setIsCheckoutModalOpen(false)}
        listing={checkoutListing}
        user={user}
        onOrderCompleted={(order) => console.log('Order sealed:', order)}
      />

      <AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        initialMode={authMode}
        initialIntent={authIntent}
        onAuthenticated={(u) => {
          setUser(u);
          setActivePage(u.role === 'buyer' ? 'marketplace' : 'creator_desk');
        }}
      />

      <SiteFooter onNavigate={setActivePage} onOpenAuth={openAuth} />
    </div>
  );
}
