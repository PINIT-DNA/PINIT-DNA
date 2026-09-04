import React, { useEffect, useRef, useState } from 'react';
import {
  ShieldCheck, LogIn, LogOut,
  ShoppingCart, Heart, Search, Menu, X, Plus,
} from 'lucide-react';
import { resolveExchangeAccount } from '../lib/roles.js';

import { resolveHubAppUrl } from '../lib/exchange-routes.js';

const HUB_APP_URL = resolveHubAppUrl();

function IconBtn({ title, active, onClick, children, badge }) {
  return (
    <button
      type="button"
      className={`btn-secondary nav-icon-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
      {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}

function MenuGroup({ label, children }) {
  return (
    <div className="studio-menu__group">
      <div className="studio-menu__label">{label}</div>
      {children}
    </div>
  );
}

function AccountMenuBody({
  account,
  seller,
  sellerPending,
  closeGo,
  onEnableBuyer,
  onBecomeCreator,
  onOpenListFromHub,
  onSignOut,
  onClose,
}) {
  const name = account.displayName || 'Account';
  return (
    <>
      <div className="studio-menu__meta">
        <strong>{name}</strong>
        {account.pinitId ? <span className="studio-menu__id">{account.pinitId}</span> : null}
      </div>

      <MenuGroup label="Buy">
        <button type="button" onClick={() => closeGo('marketplace')}>Discover</button>
        {account.canPurchase ? (
          <>
            <button type="button" onClick={() => closeGo('my_licenses')}>Purchases</button>
            <button type="button" onClick={() => closeGo('cart')}>Cart</button>
            <button type="button" onClick={() => closeGo('wishlist')}>Wishlist</button>
          </>
        ) : account.needsBuyerEnable ? (
          <button
            type="button"
            onClick={() => {
              onClose?.();
              onEnableBuyer?.();
            }}
          >
            Become a Buyer
          </button>
        ) : null}
      </MenuGroup>

      <MenuGroup label="Sell">
        {seller ? (
          <>
            <button type="button" onClick={() => closeGo('seller_overview')}>Overview</button>
            <button type="button" onClick={() => closeGo('seller_assets')}>Assets</button>
            <button type="button" onClick={() => closeGo('seller_listings')}>Listings</button>
            <button type="button" onClick={() => closeGo('seller_sales')}>Sales</button>
            <button type="button" onClick={() => closeGo('seller_earnings')}>Earnings</button>
          </>
        ) : sellerPending ? (
          <button type="button" onClick={() => closeGo('seller_onboarding_payment')}>Finish selling</button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                onClose?.();
                onBecomeCreator?.();
              }}
            >
              Start selling
            </button>
            <button
              type="button"
              onClick={() => {
                onClose?.();
                onOpenListFromHub?.();
              }}
            >
              List your protected work from Pinit HUB
            </button>
          </>
        )}
      </MenuGroup>

      <MenuGroup label="Account">
        <button type="button" onClick={() => closeGo('settings')}>Profile</button>
        <button type="button" onClick={() => closeGo('settings')}>Settings</button>
        <a href={HUB_APP_URL} target="_blank" rel="noreferrer">Open Pinit Hub</a>
        <button type="button" onClick={() => { onClose?.(); onSignOut?.(); }}>
          <LogOut size={14} /> Sign out
        </button>
      </MenuGroup>
    </>
  );
}

export default function ExchangeHeader({
  activePage,
  shopModule = 'buy',
  setActivePage,
  onOpenAuth,
  onBecomeCreator,
  onEnableBuyer,
  onOpenListFromHub,
  onOpenBuyModule,
  onOpenSellModule,
  onSignOut,
  onSearch,
  user,
  cartCount = 0,
  wishlistCount = 0,
}) {
  const account = resolveExchangeAccount(user);
  const seller = account.canList;
  const sellerPending = account.sellerIntent && !account.canList;
  const signedIn = Boolean(user);
  const inBuy = shopModule !== 'sell';
  const showBuyerTools = inBuy;
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState('');
  const menuRef = useRef(null);
  const name = account.displayName || 'Account';

  const buyLinks = [
    ['marketplace', 'Discover'],
    ['collections', 'Collections'],
    ['passports', 'Creators'],
    ['collectors', 'Collectors'],
  ];
  if (signedIn && account.canPurchase) {
    buyLinks.push(['my_licenses', 'Purchases']);
  }
  const sellLinks = seller
    ? [
      ['seller_overview', 'Overview'],
      ['seller_assets', 'Assets'],
      ['seller_listings', 'Listings'],
      ['seller_opportunities', 'Opportunities'],
      ['seller_sales', 'Sales'],
      ['seller_earnings', 'Earnings'],
    ]
    : [];
  const links = inBuy ? buyLinks : sellLinks;

  const isActive = (page) => {
    if (page === 'seller_overview') {
      return activePage === 'seller_overview' || activePage === 'creator_studio';
    }
    if (page === 'seller_listings') {
      return activePage === 'seller_listings' || activePage === 'creator_desk' || activePage === 'seller_asset_activity';
    }
    if (page === 'seller_assets') {
      return activePage === 'seller_assets' || activePage === 'seller_portfolio';
    }
    if (page === 'seller_sales') {
      return ['seller_sales', 'seller_orders', 'seller_reviews', 'seller_analytics', 'seller_promotions', 'seller_alerts'].includes(activePage);
    }
    return activePage === page;
  };

  const search = (e) => {
    e?.preventDefault?.();
    onSearch?.(query.trim());
    setActivePage('marketplace');
  };

  const closeGo = (page) => {
    setMenu(false);
    setDrawer(false);
    setActivePage(page);
  };

  useEffect(() => {
    if (!menu) return undefined;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenu(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawer]);

  const menuProps = {
    account,
    seller,
    sellerPending,
    closeGo,
    onEnableBuyer,
    onBecomeCreator,
    onOpenListFromHub,
    onSignOut,
    onClose: () => { setMenu(false); setDrawer(false); },
  };

  return (
    <header className="header-nav">
      <div className="nav-container">
        <button
          type="button"
          className="nav-hamburger"
          aria-label={drawer ? 'Close menu' : 'Open menu'}
          aria-expanded={drawer}
          onClick={() => setDrawer((v) => !v)}
        >
          {drawer ? <X size={18} /> : <Menu size={18} />}
        </button>

        <a
          href="/exchange/discover"
          className="brand-logo"
          onClick={(e) => {
            e.preventDefault();
            setDrawer(false);
            setActivePage('marketplace');
          }}
        >
          <div className="brand-mark">
            <ShieldCheck size={20} color="#fff" />
          </div>
          <span>
            Pinit <span style={{ color: 'var(--primary)', fontWeight: 400 }}>Exchange</span>
          </span>
        </a>

        <div className="ex-module-switch" role="tablist" aria-label="Switch marketplace view">
          <button
            type="button"
            role="tab"
            aria-selected={inBuy}
            title="Switch marketplace view"
            className={`ex-module-switch__btn ${inBuy ? 'is-on' : ''}`}
            onClick={onOpenBuyModule}
          >
            Buy
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!inBuy}
            title="Switch marketplace view"
            className={`ex-module-switch__btn ${!inBuy ? 'is-on' : ''}`}
            onClick={onOpenSellModule}
          >
            Sell
          </button>
        </div>

        <nav className="nav-links" aria-label="Primary">
          {links.map(([page, label]) => (
            <button
              key={`${page}-${label}`}
              type="button"
              className={`nav-link ${isActive(page) ? 'active' : ''}`}
              onClick={() => setActivePage(page)}
            >
              {label}
            </button>
          ))}
        </nav>

        <form className="nav-search" onSubmit={search} role="search">
          <Search size={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search creative work, creators, or assets…"
            aria-label="Search the marketplace"
          />
        </form>

        <div className="nav-actions">
          {!signedIn && inBuy && (
            <button
              type="button"
              className="btn-secondary nav-primary-action"
              style={{ padding: '8px 12px', height: 36, fontSize: '0.8rem' }}
              onClick={() => onOpenAuth?.({ mode: 'signup', intent: 'creator' })}
            >
              Sell
            </button>
          )}
          {signedIn && sellerPending && !inBuy && (
            <button
              type="button"
              className="btn-secondary nav-primary-action"
              style={{ padding: '8px 12px', height: 36, fontSize: '0.8rem' }}
              onClick={() => setActivePage('seller_onboarding_payment')}
            >
              Finish selling
            </button>
          )}
          {seller && (
            <button
              type="button"
              className="btn-primary nav-primary-action"
              style={{ padding: '8px 12px', height: 36, fontSize: '0.8rem' }}
              onClick={onOpenListFromHub}
            >
              <Plus size={14} /> List an asset
            </button>
          )}

          {showBuyerTools && (
            <>
              <IconBtn title="Saved assets" active={activePage === 'wishlist'} onClick={() => setActivePage('wishlist')} badge={wishlistCount}>
                <Heart size={16} />
              </IconBtn>
              <IconBtn title="Cart" active={activePage === 'cart'} onClick={() => setActivePage('cart')} badge={cartCount}>
                <ShoppingCart size={16} />
              </IconBtn>
            </>
          )}

          {user ? (
            <div className="studio-profile" ref={menuRef}>
              <button
                type="button"
                className="nav-account"
                onClick={() => {
                  if (window.matchMedia('(max-width: 768px)').matches) {
                    setDrawer((v) => !v);
                    setMenu(false);
                    return;
                  }
                  setMenu((v) => !v);
                }}
                aria-expanded={menu || drawer}
                aria-haspopup="menu"
              >
                <span className="nav-account__avatar">{name[0].toUpperCase()}</span>
                <span className="nav-account__meta">
                  <span className="nav-account__role">{name}</span>
                  <span className="nav-account__id">{account.pinitId || 'Account'}</span>
                </span>
              </button>
              {menu && (
                <div className="studio-menu" role="menu">
                  <AccountMenuBody {...menuProps} />
                </div>
              )}
            </div>
          ) : (
            <>
              <button type="button" className="btn-secondary" style={{ height: 36, padding: '8px 12px' }} onClick={() => onOpenAuth?.({ mode: 'login' })}>
                <LogIn size={16} /> Sign in
              </button>
              <button type="button" className="btn-primary nav-signup" style={{ height: 36, padding: '8px 12px' }} onClick={() => onOpenAuth?.({ mode: 'welcome' })}>
                Sign up
              </button>
            </>
          )}
        </div>
      </div>

      {drawer && (
        <div className="ex-drawer-backdrop" onClick={() => setDrawer(false)} role="presentation">
          <div
            className="ex-drawer"
            role="dialog"
            aria-label="Account menu"
            onClick={(e) => e.stopPropagation()}
          >
            <nav className="ex-drawer__links" aria-label="Marketplace view">
              <button type="button" className={inBuy ? 'is-active' : ''} onClick={() => { setDrawer(false); onOpenBuyModule?.(); }}>Buy</button>
              <button type="button" className={!inBuy ? 'is-active' : ''} onClick={() => { setDrawer(false); onOpenSellModule?.(); }}>Sell</button>
            </nav>
            {user ? (
              <AccountMenuBody {...menuProps} />
            ) : (
              <div className="ex-drawer__guest">
                <button type="button" className="btn-primary" onClick={() => { setDrawer(false); onOpenAuth?.({ mode: 'welcome' }); }}>
                  Sign up
                </button>
                <button type="button" className="btn-secondary" onClick={() => { setDrawer(false); onOpenAuth?.({ mode: 'login' }); }}>
                  Sign in
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
