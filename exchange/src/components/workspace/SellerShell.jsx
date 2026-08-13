import React, { useState } from 'react';
import {
  ShieldCheck, LayoutDashboard, Images, LayoutGrid, ListTree, PlusCircle, BadgeDollarSign,
  Receipt, Wallet, Star, LineChart, Megaphone, ClipboardList, Bell, Lock,
  ExternalLink, Settings, LogOut, Store,
} from 'lucide-react';

const HUB_APP_URL = (import.meta.env.VITE_HUB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

const NAV = [
  { id: 'creator_studio', label: 'Overview', icon: LayoutDashboard },
  { heading: 'Sell' },
  { id: 'seller_assets', label: 'My Assets', icon: Images },
  { id: 'seller_portfolio', label: 'Portfolio', icon: LayoutGrid },
  { id: 'seller_listings', label: 'Listings', icon: ListTree },
  { id: 'add', label: 'Add Asset', icon: PlusCircle, action: 'list' },
  { heading: 'Business' },
  { id: 'seller_sales', label: 'Sales', icon: BadgeDollarSign },
  { id: 'seller_orders', label: 'Orders', icon: Receipt },
  { id: 'seller_earnings', label: 'Earnings', icon: Wallet },
  { id: 'seller_reviews', label: 'Reviews', icon: Star },
  { heading: 'Marketplace' },
  { id: 'marketplace', label: 'Browse Exchange', icon: Store },
  { id: 'seller_opportunities', label: 'Opportunities', icon: ClipboardList },
  { heading: 'Grow' },
  { id: 'seller_analytics', label: 'Analytics', icon: LineChart },
  { id: 'seller_promotions', label: 'Promotions', icon: Megaphone },
  { heading: 'Protection' },
  { id: 'seller_alerts', label: 'Hub Alerts', icon: Bell },
  { id: 'hub_protect', label: 'Asset Protection', icon: Lock, href: `${HUB_APP_URL}/vault` },
];

const TOP = [
  ['creator_studio', 'Dashboard'],
  ['marketplace', 'Marketplace'],
  ['seller_assets', 'My Assets'],
  ['seller_portfolio', 'Portfolio'],
  ['seller_listings', 'Listings'],
  ['seller_sales', 'Sales'],
  ['seller_earnings', 'Earnings'],
];

export default function SellerShell({
  activePage,
  onNavigate,
  onOpenListFromHub,
  onSignOut,
  user,
  children,
}) {
  const [menu, setMenu] = useState(false);
  const name = user?.display_name || user?.name || 'Creator';
  const pinitId = user?.pinit_id || '';

  const go = (id) => {
    setMenu(false);
    onNavigate(id);
  };

  return (
    <div className="studio-shell">
      <aside className="studio-sidebar">
        <button type="button" className="studio-brand" onClick={() => go('creator_studio')}>
          <span className="brand-mark"><ShieldCheck size={18} color="#fff" /></span>
          <span>
            Pinit <span style={{ color: 'var(--primary)', fontWeight: 400 }}>Exchange</span>
            <small>Creator Studio</small>
          </span>
        </button>

        <nav className="studio-nav" aria-label="Creator Studio">
          {NAV.map((item, i) => {
            if (item.heading) {
              return <div key={`h-${item.heading}-${i}`} className="studio-nav__heading">{item.heading}</div>;
            }
            const Icon = item.icon;
            if (item.href) {
              return (
                <a key={item.id} className="studio-nav__item" href={item.href} target="_blank" rel="noreferrer">
                  <Icon size={16} /> {item.label} <ExternalLink size={11} style={{ marginLeft: 'auto', opacity: 0.6 }} />
                </a>
              );
            }
            if (item.action === 'list') {
              return (
                <button key={item.id} type="button" className="studio-nav__item" onClick={onOpenListFromHub}>
                  <Icon size={16} /> {item.label}
                </button>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                className={`studio-nav__item ${activePage === item.id ? 'active' : ''}`}
                onClick={() => go(item.id)}
              >
                <Icon size={16} /> {item.label}
              </button>
            );
          })}
        </nav>

        <div className="studio-sidebar__foot">
          <a className="studio-nav__item studio-nav__hub" href={HUB_APP_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Open Pinit Hub
          </a>
          <button type="button" className={`studio-nav__item ${activePage === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}>
            <Settings size={16} /> Settings
          </button>
        </div>
      </aside>

      <div className="studio-main">
        <header className="studio-top">
          <nav className="studio-top__links">
            {TOP.map(([page, label]) => (
              <button
                key={page}
                type="button"
                className={`nav-link ${activePage === page ? 'active' : ''}`}
                onClick={() => go(page)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="studio-top__actions">
            <button type="button" className="btn-secondary nav-icon-btn" title="Marketplace" onClick={() => go('marketplace')}>
              <Store size={16} />
            </button>
            <button type="button" className="btn-secondary nav-icon-btn" title="Hub alerts" onClick={() => go('seller_alerts')}>
              <Bell size={16} />
            </button>
            <div className="studio-profile">
              <button type="button" className="nav-account" onClick={() => setMenu((v) => !v)}>
                <span className="nav-account__avatar">{name[0].toUpperCase()}</span>
                <span className="nav-account__meta">
                  <span className="nav-account__role">Creator Account</span>
                  <span className="nav-account__id">{pinitId}</span>
                </span>
              </button>
              {menu && (
                <div className="studio-menu">
                  <div className="studio-menu__meta">
                    <strong>{name}</strong>
                    <span>Verified Creator</span>
                  </div>
                  <button type="button" onClick={() => go('settings')}>Profile &amp; settings</button>
                  <button type="button" onClick={() => go('seller_alerts')}>Notifications</button>
                  <a href={HUB_APP_URL} target="_blank" rel="noreferrer">Open Pinit Hub</a>
                  <button type="button" onClick={onSignOut}><LogOut size={14} /> Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="studio-content">{children}</div>
      </div>
    </div>
  );
}
