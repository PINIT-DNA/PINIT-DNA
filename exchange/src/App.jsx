import React, { useState, useEffect } from 'react';
import ExchangeHeader from './components/ExchangeHeader.jsx';
import ListFromHubModal from './components/ListFromHubModal.jsx';
import CheckoutModal from './components/CheckoutModal.jsx';
import BecomeCreatorModal from './components/BecomeCreatorModal.jsx';
import AuthModal, { INTENT_KEY } from './components/AuthModal.jsx';
import { clearSession, readCachedUser, readSession, writeSession } from './lib/session.js';
import {
  canList, canPurchase, homePageForUser, canAccessPage, resolveExchangeAccount,
} from './lib/roles.js';

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
import CreatorStudio from './pages/CreatorStudio.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import SellerAccountNav, { isSellerAccountPage } from './components/SellerAccountNav.jsx';
import SellerAssets from './pages/seller/SellerAssets.jsx';
import SellerPortfolio from './pages/seller/SellerPortfolio.jsx';
import SellerListings from './pages/seller/SellerListings.jsx';
import SellerAssetActivity from './pages/seller/SellerAssetActivity.jsx';
import SellerSales from './pages/seller/SellerSales.jsx';
import SellerEarnings from './pages/seller/SellerEarnings.jsx';
import SellerReviews from './pages/seller/SellerReviews.jsx';
import SellerAnalytics from './pages/seller/SellerAnalytics.jsx';
import SellerPromotions from './pages/seller/SellerPromotions.jsx';
import SellerAlerts from './pages/seller/SellerAlerts.jsx';
import SellerPaymentOnboarding from './pages/SellerPaymentOnboarding.jsx';
import BuyerPayments from './pages/buyer/BuyerPayments.jsx';
import BuyerOrders from './pages/buyer/BuyerOrders.jsx';
import BuyerNotifications from './pages/buyer/BuyerNotifications.jsx';
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
import { applyPageMeta, pageFromPath, pathForPage, portfolioSlugFromPath, resolveHubAppUrl } from './lib/exchange-routes.js';
import PublicPortfolioPage from './pages/PublicPortfolio.jsx';

const HUB_APP_URL = resolveHubAppUrl();

export default function App() {
  const [activePage, setActivePage] = useState(() => pageFromPath(window.location.pathname));
  const [portfolioSlug, setPortfolioSlug] = useState(() => portfolioSlugFromPath(window.location.pathname));

  const navigate = (page, opts = {}) => {
    if (!page) return;
    setActivePage(page);
    if (opts.slug) setPortfolioSlug(String(opts.slug).toLowerCase());
    applyPageMeta(page);
    const next = pathForPage(page, { slug: opts.slug || portfolioSlug });
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
  // Set when a Collections category tile is opened, so Discover lands already
  // filtered to that vertical. Carries a timestamp so selecting the same
  // category twice still re-applies it.
  const [collectionVertical, setCollectionVertical] = useState(null);
  // Which asset the creator opened Asset 360 for.
  const [activityAssetId, setActivityAssetId] = useState(null);
  // Search term handed down from the header. Carries a timestamp so repeating
  // the same term still re-triggers the search rather than being a no-op.
  const [headerSearch, setHeaderSearch] = useState(null);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('welcome');
  const [authIntent, setAuthIntent] = useState(null);
  const [becomeCreatorOpen, setBecomeCreatorOpen] = useState(false);
  const [roleNotice, setRoleNotice] = useState('');
  const [user, setUser] = useState(() => readCachedUser());
  const [sessionReady, setSessionReady] = useState(() => Boolean(readCachedUser()));
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
    let cancelled = false;
    (async () => {
      await restoreSession();
      if (!cancelled) await handleHubHandoff();
      if (!cancelled) setSessionReady(true);
    })();
    applyPageMeta(pageFromPath(window.location.pathname));
    const onPop = () => {
      const page = pageFromPath(window.location.pathname);
      setActivePage(page);
      setPortfolioSlug(portfolioSlugFromPath(window.location.pathname));
      applyPageMeta(page);
    };
    const onStorage = (e) => {
      if (e.key !== 'pinit_exchange_session') return;
      setUser(readCachedUser());
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('storage', onStorage);
    };
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
    clearSession();
    try {
      sessionStorage.removeItem(INTENT_KEY);
    } catch {
      /* ignore */
    }
    setUser(null);
    navigate('marketplace');
  };

  const saveSession = (u, token) => {
    writeSession(u, token);
  };

  const restoreSession = async () => {
    try {
      const session = readSession();
      if (session?.user) setUser(session.user);
      const pinitId = session?.pinit_id;
      if (!pinitId) return;
      // apiFetch attaches the session token, so the server can resolve "me"
      // from the session rather than trusting the id in the query string.
      const res = await apiFetch(`/api/auth/me?pinit_id=${encodeURIComponent(pinitId)}`);
      if (res.ok) {
        const fresh = res.data;
        if (fresh?.pinit_id) {
          setUser(fresh);
          writeSession(fresh);
        }
        return;
      }
      // Network / 5xx: keep the cached login. Only drop it if the account is gone.
      if (res.status === 401 || res.status === 404) {
        clearSession();
        setUser(null);
      }
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
        // URL intent wins (buyer return from Hub). Stale sessionStorage must not force creator.
        const intent = paramsIntent === 'creator'
          ? 'creator'
          : paramsIntent === 'buyer'
            ? 'buyer'
            : storedIntent === 'creator'
              ? 'creator'
              : 'buyer';
        const res = await fetch('/api/auth/hub-sso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: hubSso, intent }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setUser(data.user);
            // Keep the signed token — it is what proves this browser's
            // identity on every later request.
            saveSession(data.user, data.session_token);
            setAuthOpen(false);
            setRoleNotice('');
            navigate(homePageForUser(data.user), { replace: true });
            try {
              sessionStorage.removeItem(INTENT_KEY);
            } catch {
              /* ignore */
            }
          } else {
            setRoleNotice('Hub signed in, but Exchange did not receive a user profile.');
            openAuth({ mode: 'login', intent });
          }
        } else {
          let msg = 'Could not sign in with Hub.';
          try {
            const data = await res.json();
            msg = data.message || data.error || msg;
          } catch {
            if (res.status === 502 || res.status === 503 || res.status === 504) {
              msg = 'Exchange API is offline. Start the Exchange server, then try again.';
            }
          }
          setRoleNotice(msg);
          openAuth({ mode: 'login', intent });
        }
      }

      if (hubList) {
        const res = await fetch('/api/listings/from-hub', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hub_list_token: hubList }),
        });
        if (res.status === 403) {
          setRoleNotice('Buyer Hub assets stay private. Set up a Creator account in Account settings to list.');
          navigate('settings', { replace: true });
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
          navigate(canList(user) || data.asset ? 'seller_listings' : 'marketplace', { replace: true });
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
      setRoleNotice('Could not reach Exchange to finish Hub sign-in. Confirm the Exchange API is running.');
      openAuth({ mode: 'login' });
    }
  };

  /**
   * Becoming a Creator is a deliberate, paid decision, so it starts in one
   * place: Account settings.
   *
   * This used to open an upgrade modal on top of whatever the buyer was doing —
   * clicking Sell, opening a listing page, or hitting a 403 from Hub. Being
   * asked to buy a subscription because you clicked the wrong nav item reads as
   * a sales prompt, not an account setting. A buyer is now told where the
   * option lives and taken there.
   */
  const openBecomeCreator = () => {
    if (!user) {
      openAuth({ mode: 'signup', intent: 'creator' });
      return;
    }
    setRoleNotice('Creator accounts are set up in Account settings.');
    navigate('settings');
  };

  const openListFromHub = (assetId) => {
    if (!user) {
      openAuth({ mode: 'signup', intent: 'creator' });
      return;
    }
    if (!canList(user)) {
      setRoleNotice('Buyer accounts keep Hub assets private. Set up a Creator account in Account settings to list.');
      navigate('settings');
      return;
    }
    setPreselectedAssetId(assetId || null);
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
    if (!sessionReady) return;
    if (activePage === 'public_portfolio') return;
    if (user && canList(user) && (activePage === 'home' || activePage === 'creator_desk' || activePage === 'creator_studio')) {
      navigate(activePage === 'home' ? 'marketplace' : 'seller_listings', { replace: true });
      return;
    }
    if (!canAccessPage(user, activePage)) {
      if (!user) {
        navigate('marketplace', { replace: true });
        openAuth({ mode: 'login' });
        return;
      }
      if (canList(user)) {
        setRoleNotice('Creator accounts browse the marketplace but cannot purchase.');
        navigate('marketplace', { replace: true });
      } else if (resolveExchangeAccount(user).workspace === 'seller') {
        setRoleNotice('Verify a payment method to access seller tools.');
        navigate('seller_onboarding_payment', { replace: true });
      } else {
        setRoleNotice('Listing pages are for Creator accounts. You can set one up in Account settings.');
        navigate('settings', { replace: true });
      }
    }
  }, [activePage, user, sessionReady]);

  const account = resolveExchangeAccount(user);
  const notice = roleNotice ? (
    <div className="exchange-role-notice" role="status">
      {roleNotice}
      <button type="button" onClick={() => setRoleNotice('')}>Dismiss</button>
    </div>
  ) : null;

  const pages = (
      <>
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
                externalSearch={headerSearch}
                externalVertical={collectionVertical}
                onCartChanged={refreshCartCount}
              />
            )}

        {activePage === 'listing_detail' && (
          <ListingDetail
            listingId={selectedListingId}
            onBack={() => navigate('marketplace')}
            onOpenCheckout={handleOpenCheckout}
            onManageListing={() => navigate('seller_listings')}
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
            user={user}
            onSelectListing={handleSelectListing}
            onBrowseVertical={(verticalId) => {
              // Open Discover already filtered to that category, rather than
              // jumping into whichever asset happened to be first in it.
              setCollectionVertical({ vertical: verticalId, at: Date.now() });
              navigate('marketplace');
            }}
            onNavigateMarketplace={() => navigate('marketplace')}
          />
        )}
        {(activePage === 'requirements' || activePage === 'seller_opportunities') && (
          <RequirementsExchange
            mode={activePage === 'seller_opportunities' || resolveExchangeAccount(user).workspace === 'seller' ? 'seller' : 'buyer'}
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
            // Certificates live on the Purchases page. This previously popped an
            // alert claiming the certificate was "verified tamper-proof" — no
            // verification had run, so the claim was fabricated.
            onViewCertificate={() => navigate('my_licenses')}
          />
        )}

        {activePage === 'creator_studio' && (
          <CreatorStudio
            user={user}
            onNavigate={navigate}
            onSelectListing={handleSelectListing}
          />
        )}

        {(activePage === 'creator_desk' || activePage === 'seller_listings') && (
          <SellerListings
            user={user}
            onOpenListFromHub={openListFromHub}
            onSelectListing={handleSelectListing}
            onNavigate={navigate}
            onOpenAssetActivity={(assetId) => {
              setActivityAssetId(assetId);
              navigate('seller_asset_activity');
            }}
          />
        )}
        {activePage === 'seller_asset_activity' && (
          <SellerAssetActivity
            user={user}
            assetId={activityAssetId}
            onBack={() => navigate('seller_listings')}
            onSelectListing={handleSelectListing}
          />
        )}
        {activePage === 'seller_assets' && (
          <SellerAssets
            user={user}
            onOpenListFromHub={openListFromHub}
            onSelectListing={handleSelectListing}
            hubAppUrl={HUB_APP_URL}
          />
        )}
        {activePage === 'seller_portfolio' && (
          <SellerPortfolio
            user={user}
            onOpenListFromHub={openListFromHub}
            onSelectListing={handleSelectListing}
            onNavigate={navigate}
          />
        )}
        {activePage === 'seller_sales' && <SellerSales user={user} mode="sales" />}
        {activePage === 'seller_orders' && <SellerSales user={user} mode="orders" />}
        {activePage === 'seller_earnings' && <SellerEarnings user={user} onNavigate={navigate} />}
        {activePage === 'seller_reviews' && (
          <SellerReviews user={user} onSelectListing={handleSelectListing} />
        )}
        {activePage === 'seller_analytics' && (
          <SellerAnalytics user={user} onSelectListing={handleSelectListing} />
        )}
        {activePage === 'seller_promotions' && <SellerPromotions user={user} />}
        {activePage === 'seller_alerts' && <SellerAlerts user={user} hubAppUrl={HUB_APP_URL} />}
        {activePage === 'seller_onboarding_payment' && (
          <SellerPaymentOnboarding
            user={user}
            onNavigate={navigate}
            onVerified={(updatedUser) => {
              const u = updatedUser || user;
              if (u) {
                setUser(u);
                saveSession(u);
              }
              setRoleNotice('Seller account verified. You can list and sell on Exchange.');
              navigate('seller_listings');
            }}
          />
        )}
        {activePage === 'buyer_orders' && <BuyerOrders user={user} onNavigate={navigate} />}
        {activePage === 'buyer_payments' && <BuyerPayments onNavigate={navigate} />}
        {activePage === 'buyer_notifications' && (
          <BuyerNotifications user={user} onNavigate={navigate} />
        )}

        {activePage === 'settings' && (
          <SettingsPage user={user} onUserUpdated={(updated) => setUser(updated)} onNavigate={navigate} />
        )}
      </>
  );

  if (activePage === 'public_portfolio') {
    return (
      <>
        <PublicPortfolioPage
          slug={portfolioSlug}
          viewer={user}
          onNavigate={navigate}
          onOpenAuth={openAuth}
          onSelectListing={handleSelectListing}
          onOpenCheckout={handleOpenCheckout}
        />
        <AuthModal
          isOpen={authOpen}
          onClose={() => setAuthOpen(false)}
          initialMode={authMode}
          initialIntent={authIntent}
          errorMessage={roleNotice}
        />
        <CheckoutModal
          isOpen={isCheckoutModalOpen}
          onClose={() => setIsCheckoutModalOpen(false)}
          listing={checkoutListing}
          user={user}
          onOrderCompleted={(order) => console.log('Order sealed:', order)}
        />
      </>
    );
  }

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
        onOpenAuth={openAuth}
        onBecomeCreator={openBecomeCreator}
        onOpenListFromHub={openListFromHub}
        onSignOut={handleSignOut}
        onSearch={(term) => setHeaderSearch({ term, at: Date.now() })}
        user={user}
        cartCount={cartCount}
      />
      {account.canList && isSellerAccountPage(activePage) && (
        <SellerAccountNav
          activePage={activePage}
          onNavigate={navigate}
          onOpenListFromHub={openListFromHub}
        />
      )}
      {notice}
      <main style={{ flex: 1 }}>{pages}</main>
      <SiteFooter onNavigate={navigate} user={user} />

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
          navigate(canList(user) ? 'seller_listings' : 'marketplace');
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
        errorMessage={roleNotice}
      />

      <BecomeCreatorModal
        isOpen={becomeCreatorOpen}
        onClose={() => setBecomeCreatorOpen(false)}
        user={user}
        onConverted={(updated) => {
          setUser(updated);
          saveSession(updated);
          setRoleNotice('Seller account created. Pay $25 to activate listing.');
          navigate('seller_onboarding_payment');
        }}
      />

    </div>
  );
}
