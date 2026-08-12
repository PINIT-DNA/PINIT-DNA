import React from 'react';
import {
  ShieldCheck, PlusCircle, Settings, LogIn, LogOut,
  ExternalLink, ShoppingCart, Heart, Search,
} from 'lucide-react';
import { canList, canPurchase, isBuyer, isSeller, roleLabel, rolePositioning } from '../lib/roles.js';

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
  onOpenListFromHub,
  onOpenAuth,
  onBecomeCreator,
  onSignOut,
  user,
  cartCount = 0,
}) {
  const seller = canList(user);
  const buyer = canPurchase(user);
  const signedIn = Boolean(user);

  const openHub = (path = '/') => {
    window.open(`${HUB_APP_URL}${path}`, '_blank', 'noopener,noreferrer');
  };

  const links = [
    ['marketplace', 'Discover'],
    ['collections', 'Collections'],
    ['requirements', 'Requirements'],
    ...(seller ? [['creator_desk', 'My Listings']] : []),
    ...(signedIn && buyer ? [['my_licenses', 'My Library']] : []),
  ];

  return (
    <header className="header-nav">
      <div className="nav-container">
        <a
          href="/"
          className="brand-logo"
          onClick={(e) => {
            e.preventDefault();
            setActivePage('home');
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

        <div className="nav-actions">
          <IconBtn title="Search assets" onClick={() => setActivePage('marketplace')}>
            <Search size={16} />
          </IconBtn>

          {signedIn && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '8px 12px', height: 36, fontSize: '0.8rem' }}
              title="Open Pinit HUB"
              onClick={() => openHub('/')}
            >
              Open Pinit HUB <ExternalLink size={12} style={{ marginLeft: 4 }} />
            </button>
          )}

          {seller && (
            <button
              type="button"
              className="btn-primary"
              style={{ padding: '8px 14px', height: 36 }}
              title="List a protected asset"
              onClick={() => onOpenListFromHub?.()}
            >
              <PlusCircle size={16} /> List asset
            </button>
          )}

          {signedIn && buyer && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '8px 12px', height: 36, fontSize: '0.8rem' }}
              title="Become a Creator to list and sell"
              onClick={() => onBecomeCreator?.()}
            >
              Become a Creator
            </button>
          )}

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

          <IconBtn title="Saved assets" active={activePage === 'wishlist'} onClick={() => setActivePage('wishlist')}>
            <Heart size={16} />
          </IconBtn>

          {!signedIn && (
            <IconBtn title="Cart" active={activePage === 'cart'} onClick={() => setActivePage('cart')} badge={cartCount}>
              <ShoppingCart size={16} />
            </IconBtn>
          )}

          <IconBtn
            title="Account"
            active={activePage === 'settings'}
            onClick={() => {
              if (!user) {
                onOpenAuth?.({ mode: 'login' });
                return;
              }
              setActivePage('settings');
            }}
          >
            <Settings size={16} />
          </IconBtn>

          {user ? (
            <>
              <button
                type="button"
                className="nav-account"
                onClick={() => setActivePage(seller ? 'creator_desk' : 'my_licenses')}
                title={`${roleLabel(user)} · ${user.pinit_id}`}
              >
                <span className="nav-account__avatar">
                  {(user.display_name || user.name || 'P')[0].toUpperCase()}
                </span>
                <span className="nav-account__meta">
                  <span className="nav-account__role">{roleLabel(user)}</span>
                  <span className="nav-account__id">{user.pinit_id || 'Account'}</span>
                </span>
              </button>
              <IconBtn title="Sign out" onClick={onSignOut}>
                <LogOut size={16} />
              </IconBtn>
            </>
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
      {signedIn && (
        <div className="exchange-role-strip" role="status">
          <strong>{isSeller(user) && !isBuyer(user) ? 'Creator account' : isBuyer(user) && !isSeller(user) ? 'Buyer account' : roleLabel(user)}</strong>
          <span>{rolePositioning(user)}</span>
        </div>
      )}
    </header>
  );
}
