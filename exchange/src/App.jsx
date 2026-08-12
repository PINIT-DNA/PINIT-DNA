import React, { useState, useEffect } from 'react';
import ExchangeHeader from './components/ExchangeHeader.jsx';
import ListFromHubModal from './components/ListFromHubModal.jsx';
import CheckoutModal from './components/CheckoutModal.jsx';
import BecomeCreatorModal from './components/BecomeCreatorModal.jsx';
import AuthModal, { SESSION_KEY, INTENT_KEY } from './components/AuthModal.jsx';
import { canList, canPurchase, SELLER_ONLY_PAGES, BUYER_ONLY_PAGES } from './lib/roles.js';

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
import CreatorProgramPage from './pages/info/CreatorProgramPage.jsx';
import LicensingGuidePage from './pages/info/LicensingGuidePage.jsx';
import ProvenancePage from './pages/info/ProvenancePage.jsx';
import SecurityPage from './pages/info/SecurityPage.jsx';
import SellOnPinitPage from './pages/info/SellOnPinitPage.jsx';
import CreatorSupportPage from './pages/info/CreatorSupportPage.jsx';
import {
  TermsPage, PrivacyPage, LicenseAgreementPage, RefundPolicyPage, NotFoundPage,
} from './pages/info/LegalPages.jsx';
import { apiFetch } from './lib/api.js';
import { buyerKey } from './lib/buyer.js';
import { applyPageMeta, pageFromPath, pathForPage } from './lib/exchange-routes.js';

const HUB_APP_URL = (import.meta.env.VITE_HUB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function App() {
  const [activePage, setActivePage] = useState(() => pageFromPath(window.location.pathname));

  const navigate = (page, opts = {}) => {
    if (!page) return;
    setActivePage(page);
    applyPageMeta(page);
    const next = pathForPage(page);
    if (window.location.pathname !== next) {
      window.history[opts.replace ? 'replaceState' : 'pushState']({}, '', next);
    }
    if (!opts.silent) {
      window.scrollTo(0, 0);
    }
  };

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
  const [becomeCreatorOpen, setBecomeCreatorOpen] = useState(false);
  const [roleNotice, setRoleNotice] = useState('');
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
    applyPageMeta(pageFromPath(window.location.pathname));
    const onPop = () => {
      const page = pageFromPath(window.location.pathname);
      setActivePage(page);
      applyPageMeta(page);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
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
    navigate('home');
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
        const paramsIntent = String(params.get('exchange_intent') || '').toLowerCase();
        let storedIntent = '';
        try {
          storedIntent = String(sessionStorage.getItem(INTENT_KEY) || '').toLowerCase();
        } catch {
          storedIntent = '';
        }
        // Default buyer. Creator only when Exchange signup chose Sell / Become a Creator.
        const intent = paramsIntent === 'creator' || storedIntent === 'creator' ? 'creator' : 'buyer';
        const res = await fetch('/api/auth/hub-sso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: hubSso, intent }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setUser(data.user);
            saveSession(data.user);
            setAuthOpen(false);
            navigate('marketplace', { replace: true });
            try {
              sessionStorage.removeItem(INTENT_KEY);
            } catch {
              /* ignore */
            }
          }
        }
      }

      if (hubList) {
        const res = await fetch('/api/listings/from-hub', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hub_list_token: hubList }),
        });
        if (res.status === 403) {
          setRoleNotice('Buyer Hub assets stay private. Become a Creator to list on Exchange.');
          setBecomeCreatorOpen(true);
          navigate('marketplace', { replace: true });
        } else if (res.ok) {
          const data = await res.json();
          sessionStorage.setItem('pinit_hub_list_token', hubList);
          if (data.asset?.pinit_id) {
            try {
              const me = await fetch(`/api/auth/me?pinit_id=${encodeURIComponent(data.asset.pinit_id)}`);
              if (me.ok) {
                const u = await me.json();
                setUser(u);
                saveSession(u);
              }
            } catch {
              /* keep current session */
            }
          }
          if (canList(user) || data.asset) {
            setPreselectedAssetId(data.asset?.asset_id || data.intent?.asset_id || null);
            setIsListModalOpen(true);
          }
          navigate('marketplace', { replace: true });
          setMarketplaceResetToken((n) => n + 1);
        }
      }

      if (hubSso || hubList) {
        const url = new URL(window.location.href);
        url.searchParams.delete('hub_sso');
        url.searchParams.delete('hub_list');
        url.searchParams.delete('vault_id');
        url.searchParams.delete('hub_return');
        url.searchParams.delete('exchange_intent');
        window.history.replaceState({}, '', url.pathname + url.search);
      }
    } catch (err) {
      console.error('Hub handoff failed:', err);
    }
  };

  const openBecomeCreator = () => {
    if (!user) {
      openAuth({ mode: 'signup', intent: 'creator' });
      return;
    }
    setBecomeCreatorOpen(true);
  };

  const openListFromHub = () => {
    if (!user) {
      openAuth({ mode: 'signup', intent: 'creator' });
      return;
    }
    if (!canList(user)) {
      setRoleNotice('Buyer accounts keep Hub assets private. Become a Creator to list.');
      setBecomeCreatorOpen(true);
      return;
    }
    setIsListModalOpen(true);
  };

  const requireUser = (intent, action) => {
    if (!user) {
      openAuth({ mode: intent ? 'signup' : 'welcome', intent: intent || null });
      return;
    }
    if (intent === 'creator' && !canList(user)) {
      openBecomeCreator();
      return;
    }
    if (intent === 'buyer' && !canPurchase(user)) {
      setRoleNotice('Creator accounts cannot purchase marketplace assets.');
      return;
    }
    action?.();
  };

  const handleSelectListing = (id) => {
    setSelectedListingId(id);
    navigate('listing_detail');
  };

  const handleOpenCheckout = (listing) => {
    requireUser('buyer', () => {
      setCheckoutListing(listing);
      setIsCheckoutModalOpen(true);
    });
  };

  useEffect(() => {
    if (!user) return;
    if (SELLER_ONLY_PAGES.has(activePage) && !canList(user)) {
      setRoleNotice('Creator dashboard is for seller accounts.');
      setBecomeCreatorOpen(true);
      navigate('marketplace', { replace: true });
    }
    if (BUYER_ONLY_PAGES.has(activePage) && user && !canPurchase(user)) {
      setRoleNotice('Creator accounts cannot purchase marketplace assets.');
      navigate('marketplace', { replace: true });
    }
  }, [activePage, user]);

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
      <ExchangeHeader
        activePage={activePage}
        setActivePage={navigate}
        onOpenListFromHub={openListFromHub}
        onOpenAuth={openAuth}
        onBecomeCreator={openBecomeCreator}
        onSignOut={handleSignOut}
        user={user}
        cartCount={cartCount}
      />
      {roleNotice && (
        <div className="exchange-role-notice" role="status">
          {roleNotice}
          <button type="button" onClick={() => setRoleNotice('')}>Dismiss</button>
        </div>
      )}

      <main style={{ flex: 1 }}>
        {activePage === 'home' && (
          <HomePage
            onNavigate={navigate}
            onOpenListFromHub={openListFromHub}
            onOpenAuth={openAuth}
            onBecomeCreator={openBecomeCreator}
            user={user}
            onSelectListing={handleSelectListing}
            onOpenCheckout={handleOpenCheckout}
          />
        )}

            {activePage === 'marketplace' && (
              <Marketplace
                onSelectListing={handleSelectListing}
                onOpenListFromHub={openListFromHub}
                onOpenCheckout={handleOpenCheckout}
                onBecomeCreator={openBecomeCreator}
                user={user}
                focusListingId={focusListingId}
                resetFiltersToken={marketplaceResetToken}
                onCartChanged={refreshCartCount}
              />
            )}

        {activePage === 'listing_detail' && (
          <ListingDetail
            listingId={selectedListingId}
            onBack={() => navigate('marketplace')}
            onOpenCheckout={handleOpenCheckout}
            onManageListing={() => navigate('creator_desk')}
            user={user}
            onCartChanged={refreshCartCount}
          />
        )}

        {activePage === 'cart' && (
          <CartPage
            user={user}
            onOpenAuth={openAuth}
            onSelectListing={handleSelectListing}
            onBrowse={(page) => navigate(page || 'marketplace')}
            onCheckoutDone={() => {
              refreshCartCount();
              navigate('my_licenses');
            }}
          />
        )}

        {activePage === 'wishlist' && (
          <WishlistPage
            user={user}
            onOpenAuth={openAuth}
            onSelectListing={handleSelectListing}
            onBrowse={(page) => navigate(page || 'marketplace')}
            onAddToCart={async (listing) => {
              if (user && !canPurchase(user)) {
                setRoleNotice('Creator accounts cannot add marketplace assets to cart.');
                return;
              }
              const key = buyerKey(user) || localStorage.getItem('pinit_guest_buyer') || `GUEST-${Date.now()}`;
              if (!localStorage.getItem('pinit_guest_buyer') && !user) {
                localStorage.setItem('pinit_guest_buyer', key);
              }
              await apiFetch('/api/commerce/cart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  buyer_key: key,
                  listing_id: listing.listing_id,
                  license_tier: 'commercial',
                }),
              });
              refreshCartCount();
              navigate('cart');
            }}
          />
        )}

        {activePage === 'collections' && (
          <Collections
            onSelectListing={handleSelectListing}
            onNavigateMarketplace={() => navigate('marketplace')}
          />
        )}
        {activePage === 'requirements' && (
          <RequirementsExchange
            onNavigate={navigate}
            user={user}
            onOpenAuth={openAuth}
            onBecomeCreator={openBecomeCreator}
          />
        )}
        {activePage === 'passports' && (
          <CreatorPassports
            user={user}
            onNavigate={navigate}
            onOpenAuth={openAuth}
          />
        )}
        {activePage === 'creator_program' && (
          <CreatorProgramPage onNavigate={navigate} onOpenAuth={openAuth} />
        )}
        {activePage === 'enterprise' && <EnterpriseLicensing onNavigate={navigate} />}
        {activePage === 'trust' && <TrustCenter onNavigate={navigate} />}
        {activePage === 'licensing_guide' && <LicensingGuidePage onNavigate={navigate} />}
        {activePage === 'provenance' && <ProvenancePage onNavigate={navigate} />}
        {activePage === 'security' && <SecurityPage onNavigate={navigate} />}
        {activePage === 'sell' && (
          <SellOnPinitPage
            onNavigate={navigate}
            onOpenAuth={openAuth}
            onOpenListFromHub={openListFromHub}
            user={user}
          />
        )}
        {activePage === 'creator_support' && <CreatorSupportPage onNavigate={navigate} />}
        {activePage === 'terms' && <TermsPage onNavigate={navigate} />}
        {activePage === 'privacy' && <PrivacyPage onNavigate={navigate} />}
        {activePage === 'license_agreement' && <LicenseAgreementPage onNavigate={navigate} />}
        {activePage === 'refund_policy' && <RefundPolicyPage onNavigate={navigate} />}
        {activePage === 'not_found' && <NotFoundPage onNavigate={navigate} />}
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
          navigate('marketplace');
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
      />

      <BecomeCreatorModal
        isOpen={becomeCreatorOpen}
        onClose={() => setBecomeCreatorOpen(false)}
        user={user}
        onConverted={(updated) => {
          setUser(updated);
          saveSession(updated);
          setRoleNotice('You are now a Creator. Protect assets in Pinit HUB, then list them here.');
        }}
      />

      <SiteFooter onNavigate={navigate} user={user} />
    </div>
  );
}
