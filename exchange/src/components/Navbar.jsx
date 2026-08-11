import React from 'react';
import {
  ShieldCheck, PlusCircle, ShoppingBag, Settings, LogIn, LogOut,
  ExternalLink, ShoppingCart, Heart, Search,
} from 'lucide-react';

const HUB_APP_URL = (import.meta.env.VITE_HUB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

function isHubLinkedSeller(user) {
  if (!user) return false;
  if (user.role === 'buyer') return false;
  return Boolean(Number(user.hub_linked));
}

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

export default function Navbar({
  activePage,
  setActivePage,
  onOpenListFromHub,
  onOpenAuth,
  onSignOut,
  user,
  cartCount = 0,
}) {
  const seller = isHubLinkedSeller(user);
  const isBuyer = user?.role === 'buyer';

  const openHub = (path = '/') => {
    window.open(`${HUB_APP_URL}${path}`, '_blank', 'noopener,noreferrer');
  };

  const links = isBuyer
    ? [
        ['marketplace', 'Discover'],
        ['collections', 'Collections'],
        ['my_licenses', 'My Licenses'],
        ['requirements', 'Requirements'],
      ]
    : seller
      ? [
          ['marketplace', 'Discover'],
          ['creator_desk', 'My Listings'],
          ['requirements', 'Requirements'],
        ]
      : [
          ['marketplace', 'Discover'],
          ['collections', 'Collections'],
          ['requirements', 'Requirements'],
          ['passports', 'Creators'],
        ];

  return (
    <header className="header-nav">
      <div className="nav-container">
        <a
          href="#"
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

          {seller && (
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

          {!isBuyer && (
            <button
              type="button"
              className="btn-primary"
              style={{ padding: '8px 14px', height: 36 }}
              title={seller ? 'List a protected asset' : 'Become a creator'}
              onClick={() => {
                if (!seller) {
                  onOpenAuth?.({ mode: 'signup', intent: 'creator' });
                  return;
                }
                onOpenListFromHub?.();
              }}
            >
              <PlusCircle size={16} /> {seller ? 'List asset' : 'Sell'}
            </button>
          )}

          <IconBtn title="Wishlist" active={activePage === 'wishlist'} onClick={() => setActivePage('wishlist')}>
            <Heart size={16} />
          </IconBtn>

          <IconBtn title="Cart" active={activePage === 'cart'} onClick={() => setActivePage('cart')} badge={cartCount}>
            <ShoppingCart size={16} />
          </IconBtn>

          <IconBtn
            title="My licenses"
            active={activePage === 'my_licenses'}
            onClick={() => {
              if (!user) {
                onOpenAuth?.({ mode: 'signup', intent: 'buyer' });
                return;
              }
              setActivePage('my_licenses');
            }}
          >
            <ShoppingBag size={16} />
          </IconBtn>

          <IconBtn
            title="Account settings"
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
                onClick={() => setActivePage(isBuyer ? 'my_licenses' : 'creator_desk')}
                title={isBuyer ? 'Buyer account' : `Seller · ${user.pinit_id}`}
              >
                <span className="nav-account__avatar">
                  {(user.display_name || user.name || 'P')[0].toUpperCase()}
                </span>
                <span className="nav-account__meta">
                  <span className="nav-account__role">{isBuyer ? 'Buyer' : 'Seller'}</span>
                  <span className="nav-account__id">
                    {isBuyer ? 'Pinit Exchange' : (user.pinit_id || 'Account')}
                  </span>
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
    </header>
  );
}
