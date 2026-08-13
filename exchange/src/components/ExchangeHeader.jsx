import React, { useState } from 'react';
import {
  ShieldCheck, LogIn, LogOut,
  ShoppingCart, Heart, Search,
} from 'lucide-react';
import { resolveExchangeAccount } from '../lib/roles.js';

const HUB_APP_URL = (import.meta.env.VITE_HUB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

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

export default function ExchangeHeader({
  activePage,
  setActivePage,
  onOpenAuth,
  onBecomeCreator,
  onOpenListFromHub,
  onSignOut,
  user,
  cartCount = 0,
}) {
  const account = resolveExchangeAccount(user);
  const buyer = account.canPurchase;
  const seller = account.canList;
  const signedIn = Boolean(user);
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  const name = account.displayName || (seller ? 'Creator' : 'Buyer');

  const links = seller
    ? [
      ['marketplace', 'Discover'],
      ['collections', 'Collections'],
      ['passports', 'Creators'],
      ['seller_opportunities', 'Opportunities'],
      ['seller_listings', 'Your listings'],
    ]
    : signedIn && buyer
      ? [
        ['home', 'Discover'],
        ['collections', 'Collections'],
        ['passports', 'Creators'],
        ['requirements', 'Requirements'],
        ['my_licenses', 'Purchases'],
      ]
      : [
        ['marketplace', 'Discover'],
        ['collections', 'Collections'],
        ['passports', 'Creators'],
        ['requirements', 'Requirements'],
      ];

  const search = (e) => {
    e?.preventDefault?.();
    setActivePage('marketplace');
  };

  const closeGo = (page) => {
    setMenu(false);
    setActivePage(page);
  };

  return (
    <header className="header-nav">
      <div className="nav-container">
        <a
          href="/exchange/discover"
          className="brand-logo"
          onClick={(e) => {
            e.preventDefault();
            setActivePage(seller ? 'marketplace' : (signedIn ? 'home' : 'marketplace'));
          }}
        >
          <div className="brand-mark">
            <ShieldCheck size={20} color="#fff" />
          </div>
          <span>
            Pinit <span style={{ color: 'var(--primary)', fontWeight: 400 }}>Exchange</span>
          </span>
        </a>

        <nav className="nav-links" aria-label="Primary">
          {links.map(([page, label]) => (
            <button
              key={`${page}-${label}`}
              type="button"
              className={`nav-link ${activePage === page ? 'active' : ''}`}
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
            placeholder="Search photos, video, creators…"
            aria-label="Search the marketplace"
          />
        </form>

        <div className="nav-actions">
          {!signedIn && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '8px 12px', height: 36, fontSize: '0.8rem' }}
              onClick={() => onOpenAuth?.({ mode: 'signup', intent: 'creator' })}
            >
              Sell
            </button>
          )}
          {seller && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '8px 12px', height: 36, fontSize: '0.8rem' }}
              onClick={onOpenListFromHub}
            >
              List an asset
            </button>
          )}

          {(buyer || !signedIn) && (
            <>
              <IconBtn title="Saved assets" active={activePage === 'wishlist'} onClick={() => setActivePage('wishlist')}>
                <Heart size={16} />
              </IconBtn>
              <IconBtn title="Cart" active={activePage === 'cart'} onClick={() => setActivePage('cart')} badge={cartCount}>
                <ShoppingCart size={16} />
              </IconBtn>
            </>
          )}

          {user ? (
            <div className="studio-profile">
              <button type="button" className="nav-account" onClick={() => setMenu((v) => !v)}>
                <span className="nav-account__avatar">{name[0].toUpperCase()}</span>
                <span className="nav-account__meta">
                  <span className="nav-account__role">{account.uiLabel}</span>
                  <span className="nav-account__id">{account.pinitId || 'Account'}</span>
                </span>
              </button>
              {menu && (
                <div className="studio-menu">
                  <div className="studio-menu__meta">
                    <strong>{name}</strong>
                    <span>{account.uiLabel}</span>
                  </div>
                  {seller ? (
                    <>
                      <button type="button" onClick={() => closeGo('seller_portfolio')}>Portfolio</button>
                      <button type="button" onClick={() => closeGo('seller_listings')}>Your listings</button>
                      <button type="button" onClick={() => closeGo('seller_assets')}>Your assets</button>
                      <button type="button" onClick={() => closeGo('seller_sales')}>Sales</button>
                      <button type="button" onClick={() => closeGo('seller_earnings')}>Earnings</button>
                      <button type="button" onClick={() => closeGo('settings')}>Account</button>
                      <a href={HUB_APP_URL} target="_blank" rel="noreferrer">Open Pinit Hub</a>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => closeGo('settings')}>Account</button>
                      <button type="button" onClick={() => closeGo('my_licenses')}>Purchases</button>
                      <button type="button" onClick={() => closeGo('buyer_payments')}>Payment methods</button>
                      <button type="button" onClick={() => closeGo('buyer_notifications')}>Notifications</button>
                      <button type="button" onClick={() => { setMenu(false); onBecomeCreator?.(); }}>Sell on Exchange</button>
                    </>
                  )}
                  <button type="button" onClick={() => { setMenu(false); onSignOut?.(); }}><LogOut size={14} /> Sign out</button>
                </div>
              )}
            </div>
          ) : (
            <>
              <button type="button" className="btn-secondary" style={{ height: 36, padding: '8px 12px' }} onClick={() => onOpenAuth?.({ mode: 'login' })}>
                <LogIn size={16} /> Sign in
              </button>
              <button type="button" className="btn-primary" style={{ height: 36, padding: '8px 12px' }} onClick={() => onOpenAuth?.({ mode: 'welcome' })}>
                Sign up
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
