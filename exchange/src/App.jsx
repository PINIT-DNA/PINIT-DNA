import React, { useState, useEffect } from 'react';
import ExchangeHeader from './components/ExchangeHeader.jsx';
import ListFromHubModal from './components/ListFromHubModal.jsx';
import CheckoutModal from './components/CheckoutModal.jsx';
import BecomeCreatorModal from './components/BecomeCreatorModal.jsx';
import AuthModal, { INTENT_KEY } from './components/AuthModal.jsx';
import { clearSession, readCachedUser, readSession, writeSession } from './lib/session.js';
import {
  canList, canPurchase, homePageForUser, canAccessPage, resolveExchangeAccount,
  SELLER_ONLY_PAGES,
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
import BecomeSellerPanel from './components/BecomeSellerPanel.jsx';
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
import { moduleFromPage } from './lib/exchange-module.js';
import PublicPortfolioPage from './pages/PublicPortfolio.jsx';

const HUB_APP_URL = resolveHubAppUrl();

export default function App() {
  const [activePage, setActivePage] = useState(() => pageFromPath(window.location.pathname));
  const [portfolioSlug, setPortfolioSlug] = useState(() => portfolioSlugFromPath(window.location.pathname));
  const [shopModule, setShopModule] = useState(() => moduleFromPage(pageFromPath(window.location.pathname)) || 'buy');

  const navigate = (page, opts = {}) => {
    if (!page) return;
    const inferred = moduleFromPage(page);
    if (inferred) setShopModule(inferred);
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
  const [sessionReady, setSessionReady] = useState(false);
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
          writeSession(fresh, fresh.session_token);
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

  const waitForExchangeApi = async ({ attempts = 12, delayMs = 500 } = {}) => {
    for (let i = 0; i < attempts; i += 1) {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (res.ok) return true;
      } catch {
        /* API still restarting */
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  };

  const postHubSsoWithRetry = async (token, intent) => {
    let last = { ok: false, status: 0, data: null };
    for (let i = 0; i < 5; i += 1) {
      try {
        const res = await fetch('/api/auth/hub-sso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, intent }),
        });
        let data = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        last = { ok: res.ok, status: res.status, data };
        if (res.ok) return last;
        // Retry only when Exchange was briefly down / restarting.
        const retryable =
          res.status === 0 ||
          res.status === 502 ||
          res.status === 503 ||
          res.status === 504 ||
          (res.status === 500 && !data);
        if (!retryable) return last;
      } catch {
        last = { ok: false, status: 0, data: null };
      }
      await new Promise((r) => setTimeout(r, 600 + i * 250));
    }
    return last;
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

        // Hub biometrics can finish while Exchange is mid-restart (node --watch).
        // Wait for health, then retry SSO so "Database succeed" is not wasted.
        const apiUp = await waitForExchangeApi();
        const result = apiUp
          ? await postHubSsoWithRetry(hubSso, intent)
          : { ok: false, status: 0, data: null };

        if (result.ok && result.data?.user) {
          setUser(result.data.user);
          // Keep the signed token — it is what proves this browser's
          // identity on every later request.
          saveSession(result.data.user, result.data.session_token);
          setAuthOpen(false);
          setRoleNotice('');
          navigate(homePageForUser(result.data.user), { replace: true });
          try {
            sessionStorage.removeItem(INTENT_KEY);
          } catch {
            /* ignore */
          }
        } else if (result.ok) {
          setRoleNotice('Hub signed in, but Exchange did not receive a user profile.');
          openAuth({ mode: 'login', intent });
        } else {
          const msg =
            result.data?.message ||
            result.data?.error ||
            (result.status === 0 || result.status >= 500
              ? 'Exchange API was restarting. Wait a few seconds, then tap Continue with Hub again.'
              : 'Could not sign in with Hub.');
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
          setRoleNotice('Listing needs seller tools. Choose Sell on Exchange in Account — buying stays on this identity.');
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
  const openBecomeCreator = async () => {
    if (!user) {
      openAuth({ mode: 'signup', intent: 'creator' });
      return;
    }
    if (resolveExchangeAccount(user).sellerIntent && !canList(user)) {
      navigate('seller_onboarding_payment');
      return;
    }
    const { ok, data, error, status } = await apiFetch('/api/auth/become-creator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinit_id: user.pinit_id }),
    });
    if (!ok) {
      if (status === 401) {
        setRoleNotice('Continue with Pinit Hub once, then try Become a Seller again.');
        openAuth({ mode: 'login' });
        return;
      }
      setRoleNotice(error || 'Could not start selling on this account.');
      navigate('settings');
      return;
    }
    if (data?.user) {
      setUser(data.user);
      writeSession(data.user, data.session_token);
    }
    navigate('seller_onboarding_payment');
  };

  const enableBuyer = async () => {
    const { ok, data, error, status } = await apiFetch('/api/auth/enable-buyer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinit_id: user?.pinit_id }),
    });
    if (!ok) {
      if (status === 401) {
        setRoleNotice('Continue with Pinit HUB once, then try again. No second account is created.');
        openAuth({ mode: 'login' });
        return;
      }
      setRoleNotice(error || 'Could not enable Buyer on this account.');
      return;
    }
    if (data?.user) {
      setUser(data.user);
      writeSession(data.user, data.session_token);
    }
    setRoleNotice('Buyer access is on. Cart, Checkout, Purchases and Wishlist are available. Selling is unchanged.');
    navigate('marketplace');
  };

  const openListFromHub = (assetId) => {
    if (!user) {
      openAuth({ mode: 'signup', intent: 'creator' });
      return;
    }
    if (!canList(user)) {
      setRoleNotice('Listing needs seller tools on this same account. Open Account to add selling.');
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
    if (intent === 'buyer' && !canPurchase(user)) {
      setRoleNotice('Become a Buyer on this same identity to purchase. Selling stays as it is.');
      navigate('settings');
      return;
    }
    if (intent === 'creator' && !canList(user)) {
      openBecomeCreator();
      return;
    }
    action?.();
  };

  const handleSelectListing = (id, origin = 'buy') => {
    setShopModule(origin === 'sell' ? 'sell' : 'buy');
    setSelectedListingId(id);
    setActivePage('listing_detail');
    applyPageMeta('listing_detail');
    const next = pathForPage('listing_detail');
    if (window.location.pathname !== next) {
      window.history.pushState({}, '', next);
    }
    window.scrollTo(0, 0);
  };

  const openBuyModule = () => {
    setShopModule('buy');
    navigate('marketplace');
  };

  const openSellModule = () => {
    if (!user) {
      openAuth({ mode: 'signup', intent: 'creator' });
      return;
    }
    setShopModule('sell');
    if (canList(user)) {
      navigate('seller_listings');
      return;
    }
    if (resolveExchangeAccount(user).sellerIntent) {
      navigate('seller_onboarding_payment');
      return;
    }
    openBecomeCreator();
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
    if (user && canList(user) && (activePage === 'creator_desk' || activePage === 'creator_studio')) {
      navigate('seller_listings', { replace: true });
      return;
    }
    if (!canAccessPage(user, activePage)) {
      if (!user) {
        navigate('marketplace', { replace: true });
        openAuth({ mode: 'login' });
        return;
      }
      if (resolveExchangeAccount(user).sellerIntent && !canList(user)) {
        setRoleNotice('Pay the seller subscription to access seller tools.');
        navigate('seller_onboarding_payment', { replace: true });
      } else if (SELLER_ONLY_PAGES.has(activePage) && !canList(user)) {
        return;
      } else {
        setRoleNotice('Open Become a Seller to list and sell on this same account.');
        navigate('settings', { replace: true });
      }
    }
  }, [activePage, user, sessionReady]);

  const account = resolveExchangeAccount(user);
  const sellerLocked = Boolean(
    user
    && SELLER_ONLY_PAGES.has(activePage)
    && !account.canList
    && !account.sellerIntent,
  );
  const notice = roleNotice ? (
    <div className="exchange-role-notice" role="status">
      {roleNotice}
      <button type="button" onClick={() => setRoleNotice('')}>Dismiss</button>
    </div>
  ) : null;

  const pages = sellerLocked ? (
    <BecomeSellerPanel onStart={openBecomeCreator} />
  ) : (
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
            shopModule={shopModule}
            onBack={() => navigate(shopModule === 'sell' ? 'seller_listings' : 'marketplace')}
            onOpenCheckout={handleOpenCheckout}
            onManageListing={() => {
              setShopModule('sell');
              navigate('seller_listings');
            }}
            onOpenBuyModule={openBuyModule}
            user={user}
            onCartChanged={refreshCartCount}
            onEnableBuyer={enableBuyer}
          />
        )}

        {activePage === 'cart' && (
          <CartPage
            user={user}
            onOpenAuth={openAuth}
            onSelectListing={handleSelectListing}
            onEnableBuyer={enableBuyer}
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
            onEnableBuyer={enableBuyer}
            onBrowse={(page) => navigate(page || 'marketplace')}
            onAddToCart={async (listing) => {
              if (user && !canPurchase(user)) {
                setRoleNotice('Become a Buyer on this same identity to use cart.');
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
            mode={activePage === 'seller_opportunities' ? 'seller' : 'buyer'}
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
            onViewCertificate={() => navigate('my_licenses')}
            onEnableBuyer={enableBuyer}
            onBrowse={navigate}
          />
        )}

        {activePage === 'creator_studio' && (
          <CreatorStudio
            user={user}
            onNavigate={navigate}
            onSelectListing={(id) => handleSelectListing(id, 'sell')}
          />
        )}

        {(activePage === 'creator_desk' || activePage === 'seller_listings') && (
          <SellerListings
            user={user}
            onOpenListFromHub={openListFromHub}
            onSelectListing={(id) => handleSelectListing(id, 'sell')}
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
            onSelectListing={(id) => handleSelectListing(id, 'sell')}
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
              // Payment/status used to hand back a stale user (or no user), so
              // can_list stayed false and the route guard bounced straight back
              // to this payment page — looking like Pay did nothing.
              const base = updatedUser || user;
              if (!base) return;
              const activated = {
                ...base,
                seller_onboarding_status:
                  base.seller_onboarding_status === 'PAYMENT_METHOD_VERIFIED'
                    ? 'PAYMENT_METHOD_VERIFIED'
                    : 'SELLER_ACTIVE',
                seller_onboarding_complete: true,
                seller_payment_verified: true,
                can_list: true,
              };
              setUser(activated);
              saveSession(activated);
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
          <SettingsPage
            user={user}
            onUserUpdated={(updated, token) => {
              setUser(updated);
              writeSession(updated, token);
            }}
            onNavigate={navigate}
            onEnableBuyer={enableBuyer}
          />
        )}
      </>
  );

  const sessionPending = !sessionReady;

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
        shopModule={shopModule}
        setActivePage={navigate}
        onOpenAuth={openAuth}
        onBecomeCreator={openBecomeCreator}
        onEnableBuyer={enableBuyer}
        onOpenListFromHub={openListFromHub}
        onOpenBuyModule={openBuyModule}
        onOpenSellModule={openSellModule}
        onSignOut={handleSignOut}
        onSearch={(term) => {
          setShopModule('buy');
          setHeaderSearch({ term, at: Date.now() });
        }}
        user={user}
        cartCount={cartCount}
      />
      {account.canList && shopModule === 'sell' && (
        <SellerAccountNav
          activePage={activePage}
          onNavigate={navigate}
          onOpenListFromHub={openListFromHub}
        />
      )}
      {notice}
      <main style={{ flex: 1 }}>
        {sessionPending ? (
          <div className="ex-page" aria-busy="true" aria-label="Loading account">
            <div className="ex-skel ex-skel--line" style={{ width: '28%', height: 22, marginTop: 28 }} />
            <div className="ex-skel" style={{ height: 180, marginTop: 18, borderRadius: 14 }} />
          </div>
        ) : pages}
      </main>
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
          setRoleNotice('Seller account created. Complete the activation payment to start listing.');
          navigate('seller_onboarding_payment');
        }}
      />

    </div>
  );
}
