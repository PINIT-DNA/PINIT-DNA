import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Search, Bell, Plus, ChevronDown } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { SuperAdminSidebar } from './SuperAdminSidebar';
import { fetchExecutiveOverview } from '../api/super-admin.api';

const PAGE_TITLES: { match: (path: string) => boolean; title: string; subtitle: string }[] = [
  { match: (p) => p === '/admin', title: 'Executive Command Center', subtitle: 'Real-time overview of the PinitHUB ecosystem' },
  { match: (p) => p.startsWith('/admin/users'), title: 'User Management', subtitle: 'Every registered identity on the platform' },
  { match: (p) => p.startsWith('/admin/organizations'), title: 'Organizations', subtitle: 'Businesses, agencies, publishers and institutions' },
  { match: (p) => p.startsWith('/admin/dna'), title: 'Assets & DNA', subtitle: 'Protection records and DNA engine activity' },
  { match: (p) => p.startsWith('/admin/investigations'), title: 'Intelligence (Sentinel)', subtitle: 'Investigations, tampering and forensic detection' },
];

const QUICK_ACTIONS = [
  { label: 'Search a user', to: '/admin/users' },
  { label: 'Look up a DNA record', to: '/admin/dna' },
  { label: 'Open an investigation', to: '/admin/investigations' },
  { label: 'View admin audit log', to: '/admin/audit' },
];

export function SuperAdminLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [unread, setUnread] = useState<number | null>(null);
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

  const page = PAGE_TITLES.find((p) => p.match(location.pathname)) ?? {
    title: 'Admin Console',
    subtitle: 'PinitHUB Master Admin',
  };

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

          <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-400 w-64 shrink-0">
            <Search size={15} />
            <span className="flex-1">Search anything...</span>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-400">⌘K</kbd>
          </div>

          <button
            type="button"
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
