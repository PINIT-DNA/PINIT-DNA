import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Search, Bell, Plus, ChevronDown, Users, Building2, Boxes, X } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { SuperAdminSidebar } from './SuperAdminSidebar';
import { fetchExecutiveOverview, fetchGlobalSearch } from '../api/super-admin.api';
import type { SearchResult } from '../api/super-admin.api';

const PAGE_TITLES: { match: (path: string) => boolean; title: string; subtitle: string }[] = [
  { match: (p) => p === '/', title: 'Executive Command Center', subtitle: 'Real-time overview of the PinitHUB ecosystem' },
  { match: (p) => p.startsWith('/users'), title: 'User Management', subtitle: 'Every registered identity on the platform' },
  { match: (p) => p.startsWith('/organizations'), title: 'Organizations', subtitle: 'Businesses, agencies, publishers and institutions' },
  { match: (p) => p.startsWith('/dna'), title: 'Assets & DNA', subtitle: 'Protection records and DNA engine activity' },
  { match: (p) => p.startsWith('/investigations'), title: 'Intelligence (Sentinel)', subtitle: 'Investigations, tampering and forensic detection' },
  { match: (p) => p.startsWith('/vault/') && p.endsWith('/timeline'), title: 'Activity Timeline', subtitle: 'File-level provenance and event history' },
  { match: (p) => p.startsWith('/vault'), title: 'Vault Explorer', subtitle: 'Enterprise vault — cross-tenant view of protected files' },
  { match: (p) => p.startsWith('/files'), title: 'File Explorer', subtitle: 'Enterprise view of all uploaded files' },
  { match: (p) => p.startsWith('/certificates'), title: 'Certificate Center', subtitle: 'Issue, verify, audit and download certificates' },
  { match: (p) => p.startsWith('/tracking'), title: 'Access Intelligence', subtitle: 'Protected downloads, viewer logs, and access events' },
  { match: (p) => p.startsWith('/timeline'), title: 'Activity Timeline', subtitle: 'Live platform activity stream' },
  { match: (p) => p.startsWith('/monitoring'), title: 'Monitoring Center', subtitle: 'Crawler status, leak monitoring, and threat intelligence' },
  { match: (p) => p.startsWith('/analytics'), title: 'Analytics', subtitle: 'Platform growth, usage, and geographic intelligence (30-day window)' },
  { match: (p) => p.startsWith('/audit'), title: 'Audit Logs', subtitle: 'Security and access audit trail across the platform' },
  { match: (p) => p.startsWith('/security'), title: 'Security Center', subtitle: 'Platform security posture and threat indicators' },
  { match: (p) => p.startsWith('/billing'), title: 'Billing & Subscriptions', subtitle: 'Plans, subscriptions, revenue and billing history' },
  { match: (p) => p.startsWith('/notifications'), title: 'Notifications', subtitle: 'Platform-wide notification activity' },
  { match: (p) => p.startsWith('/threats'), title: 'Threat Center', subtitle: 'Crawler-detected leak cases and evidence' },
  { match: (p) => p.startsWith('/verification'), title: 'Identity & Verification', subtitle: 'Manual KYC review queue and biometric enrollment status' },
  { match: (p) => p.startsWith('/settings'), title: 'System & Settings', subtitle: 'Live health detail and the RBAC capability matrix' },
  { match: (p) => p.startsWith('/reports'), title: 'Reports', subtitle: 'On-demand platform summary reports, exportable as PDF or CSV' },
  { match: (p) => p.startsWith('/credits'), title: 'Credits & Usage', subtitle: 'Live storage usage against plan limits' },
  { match: (p) => p.startsWith('/network'), title: 'Network Intelligence', subtitle: 'Organizational reach — members, clients, and campaigns' },
  { match: (p) => p.startsWith('/support'), title: 'Support & Disputes', subtitle: 'Ticket queue and dispute resolution' },
];

const QUICK_ACTIONS = [
  { label: 'Search a user', to: '/users' },
  { label: 'Look up a DNA record', to: '/dna' },
  { label: 'Open an investigation', to: '/investigations' },
  { label: 'Review threat center', to: '/threats' },
  { label: 'Generate a platform report', to: '/reports' },
  { label: 'Open a support ticket', to: '/support' },
  { label: 'View admin audit log', to: '/audit' },
];

const RESULT_ICON = { user: Users, organization: Building2, asset: Boxes } as const;

export function SuperAdminLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [unread, setUnread] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    fetchExecutiveOverview()
      .then((o) => {
        const overview = o as { security?: { unreadNotifications?: number } };
        setUnread(overview?.security?.unreadNotifications ?? 0);
      })
      .catch(() => setUnread(null));
  }, []);

  // Debounced global search — any typed text or PINIT-* id.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      fetchGlobalSearch(q)
        .then((d) => setResults(d.results))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') setSearchOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const page = PAGE_TITLES.find((p) => p.match(location.pathname)) ?? {
    title: 'Admin Console',
    subtitle: 'PinitHUB Master Admin',
  };

  function goToResult(r: SearchResult) {
    setSearchOpen(false);
    setQuery('');
    navigate(r.href);
  }

  return (
    <div className="flex h-[100dvh] bg-[#F7F7FB] text-gray-900 overflow-hidden">
      <SuperAdminSidebar open={navOpen} onClose={() => setNavOpen(false)} />

      {navOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden lg:ml-72">
        <header className="h-16 shrink-0 border-b border-gray-200 bg-white flex items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="lg:hidden p-2 -ml-1 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Open admin menu"
          >
            <Menu size={20} />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-gray-900 truncate">{page.title}</h1>
            <p className="text-xs text-gray-500 truncate hidden sm:block">{page.subtitle}</p>
          </div>

          <div className="relative hidden md:block w-72 shrink-0">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 focus-within:border-indigo-400 focus-within:bg-white text-sm">
              <Search size={15} className="text-gray-400 shrink-0" />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search anything..."
                className="flex-1 min-w-0 bg-transparent outline-none text-gray-900 placeholder:text-gray-400"
              />
              {query ? (
                <button type="button" onClick={() => { setQuery(''); setResults([]); }} className="text-gray-400 hover:text-gray-600 shrink-0">
                  <X size={14} />
                </button>
              ) : (
                <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-400 shrink-0">⌘K</kbd>
              )}
            </div>

            {searchOpen && query.trim().length >= 2 && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSearchOpen(false)} aria-hidden />
                <div className="absolute left-0 top-full mt-2 w-96 max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-1 z-50">
                  {searching && <p className="px-3 py-3 text-xs text-gray-400">Searching…</p>}
                  {!searching && results.length === 0 && (
                    <p className="px-3 py-3 text-xs text-gray-400">No matches for "{query}"</p>
                  )}
                  {!searching && results.map((r) => {
                    const Icon = RESULT_ICON[r.type];
                    return (
                      <button
                        key={`${r.type}-${r.id}`}
                        type="button"
                        onClick={() => goToResult(r)}
                        className="w-full flex items-center gap-3 text-left px-3 py-2 hover:bg-gray-50"
                      >
                        <div className="w-7 h-7 rounded-md bg-indigo-50 flex items-center justify-center shrink-0">
                          <Icon size={14} className="text-indigo-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm text-gray-900 truncate">{r.title}</p>
                          <p className="text-xs text-gray-500 truncate">{r.subtitle}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => navigate('/notifications')}
            className="relative p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 shrink-0"
            title={unread ? `${unread} unread notifications` : 'Notifications'}
          >
            <Bell size={18} />
            {!!unread && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setQuickOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">Quick Action</span>
              <ChevronDown size={14} />
            </button>
            {quickOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setQuickOpen(false)} aria-hidden />
                <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-gray-200 bg-white shadow-lg py-1 z-50">
                  {QUICK_ACTIONS.map((a) => (
                    <button
                      key={a.to}
                      type="button"
                      onClick={() => {
                        setQuickOpen(false);
                        navigate(a.to);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 mobile-main">
          <Outlet />
        </main>
      </div>

      <Toaster
        position="top-center"
        containerClassName="!top-16 !bottom-auto z-[9999]"
        containerStyle={{ top: 72, bottom: 'auto' }}
        toastOptions={{
          duration: 4000,
          style: {
            background: '#18181b',
            color: '#fafafa',
            border: '1px solid #3f3f46',
            maxWidth: 'min(100vw - 24px, 360px)',
          },
        }}
      />
    </div>
  );
}
