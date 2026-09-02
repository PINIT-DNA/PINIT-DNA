import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, Shield, Archive, FileSearch,
  Award, ChevronRight, Bell,
  Radio, X,
  CreditCard, Settings, Users, Briefcase,
  HelpCircle, FolderKanban, ClipboardCheck, Activity,
} from 'lucide-react';
import { cn } from '../ui/utils';
import { useAuth } from '../../context/AuthContext';
import { useSubscription, FeatureKey } from '../../hooks/useSubscription';
import { useAccountViewMode } from '../../hooks/useAccountViewMode';
import { API_BASE_URL } from '../../config/api.config';
import { BRAND } from '../../config/brand.config';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { listVaultRecords } from '../../services/dashboard.api';
import type { VaultRecord } from '../../types/dashboard.types';

function BackendStatus() {
  const [online, setOnline] = useState<boolean | null>(null);
  const isProd = import.meta.env.PROD;

  useEffect(() => {
    let cancelled = false;

    const probe = async (): Promise<boolean> => {
      const root = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
      const urls = [`${API_BASE_URL}/ping`, `${API_BASE_URL}/health`, `${root}/health`];
      for (const url of urls) {
        try {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 25_000);
          const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
          window.clearTimeout(timer);
          if (res.ok) return true;
        } catch {
          /* try next endpoint */
        }
      }
      return false;
    };

    const check = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (cancelled) return;
        const ok = await probe();
        if (ok) {
          if (!cancelled) setOnline(true);
          return;
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 4000 + attempt * 2000));
      }
      if (!cancelled) setOnline(false);
    };

    check();
    const id = window.setInterval(check, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const isOnline = online === true;
  const isChecking = online === null;

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            isChecking && 'bg-amber-400 animate-pulse',
            isOnline && 'bg-emerald-500',
            online === false && 'bg-red-500',
          )}
          aria-hidden
        />
        <span className="text-xs text-slate-500 font-medium">
          {isChecking ? 'Checking…' : isOnline ? 'System online' : 'Backend offline'}
        </span>
      </div>
      <p className="text-2xs text-slate-400">
        {isChecking
          ? (isProd ? 'Connecting…' : 'Connecting to local API')
          : isOnline
            ? 'All systems operational'
            : (isProd ? 'API waking up — refresh in a moment' : 'Run npm run dev:all')}
      </p>
    </>
  );
}

type NavItem = {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  end?: boolean;
  feature?: string;
};

const PERSONAL_NAV: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Core',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Home', end: true },
    ],
  },
  {
    label: 'Protect',
    items: [
      { to: '/generate', icon: Shield, label: 'Protect New' },
      { to: '/vault', icon: Archive, label: 'My Assets' },
    ],
  },
  {
    label: 'Watch',
    items: [
      { to: '/monitoring', icon: Radio, label: 'Monitoring', feature: FeatureKey.FEATURE_TRACKING },
    ],
  },
  {
    label: 'Investigate',
    items: [
      { to: BRAND.investigationPath, icon: FileSearch, label: 'Investigate a File', feature: FeatureKey.FEATURE_INVESTIGATION },
      { to: '/reports', icon: Shield, label: 'Reports', feature: FeatureKey.FEATURE_INVESTIGATION },
    ],
  },
  {
    label: 'Share',
    items: [
      { to: '/certificates', icon: Award, label: 'Certificates' },
    ],
  },
];

const BUSINESS_NAV: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Core',
    items: [
      { to: '/business', icon: LayoutDashboard, label: 'Home', end: true },
    ],
  },
  {
    label: 'Protect',
    items: [
      { to: '/business/clients', icon: Briefcase, label: 'Clients' },
      { to: '/business', icon: FolderKanban, label: 'Campaigns' },
      { to: '/vault', icon: Archive, label: 'My Assets' },
    ],
  },
  {
    label: 'Work',
    items: [
      { to: '/business/team', icon: Users, label: 'Creators' },
      { to: '/business/clients', icon: ClipboardCheck, label: 'Reviews' },
      { to: '/business/audit-logs', icon: Activity, label: 'Activity' },
    ],
  },
  {
    label: 'Investigate',
    items: [
      { to: BRAND.investigationPath, icon: FileSearch, label: 'Investigate a File', feature: FeatureKey.FEATURE_INVESTIGATION },
      { to: '/reports', icon: Shield, label: 'Reports', feature: FeatureKey.FEATURE_INVESTIGATION },
      { to: '/monitoring', icon: Radio, label: 'Monitoring', feature: FeatureKey.FEATURE_TRACKING },
    ],
  },
];

const ACCOUNT_LINKS: NavItem[] = [
  { to: '/profile', icon: Settings, label: 'Settings' },
  { to: '/profile?tab=notifications', icon: Bell, label: 'Notifications' },
  { to: '/upgrade', icon: Award, label: 'Plans' },
  { to: '/subscription', icon: CreditCard, label: 'Billing' },
  { to: '/help', icon: HelpCircle, label: 'Help' },
];

function RecentProtectedNav({ onClose }: { onClose?: () => void }) {
  const [items, setItems] = useState<VaultRecord[]>([]);

  useEffect(() => {
    listVaultRecords()
      .then((rows) => {
        const sorted = [...rows].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        setItems(sorted.slice(0, 5));
      })
      .catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  return (
    <div>
      <p className="text-2xs font-bold uppercase tracking-widest px-2 mb-1 text-slate-400">
        Recently protected
      </p>
      <ul className="space-y-0.5">
        {items.map((v) => (
          <li key={v.id}>
            <NavLink
              to={`/vault?id=${encodeURIComponent(v.id)}`}
              onClick={onClose}
              title={v.originalFileName}
              className={({ isActive }) =>
                cn(
                  'block px-3 py-1.5 rounded-xl text-[12px] font-medium truncate transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-dna-500',
                  isActive
                    ? 'bg-dna-50 text-dna-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50',
                )
              }
            >
              {v.originalFileName}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

function navActive(to: string, pathname: string, search: string, end?: boolean) {
  const [path, query] = to.split('?');
  if (query) {
    const want = new URLSearchParams(query);
    const have = new URLSearchParams(search);
    if (pathname !== path) return false;
    for (const [k, v] of want.entries()) {
      if (have.get(k) !== v) return false;
    }
    return true;
  }
  if (path === '/profile') {
    return pathname === '/profile' && new URLSearchParams(search).get('tab') !== 'notifications';
  }
  if (end) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const { user } = useAuth();
  const { subscription } = useSubscription();
  const { isBusinessShell } = useAccountViewMode();
  const location = useLocation();

  const navGroups = useMemo(
    () => (isBusinessShell ? BUSINESS_NAV : PERSONAL_NAV),
    [isBusinessShell],
  );

  return (
    <aside
      className={cn(
        'hub-sidebar fixed left-0 top-0 h-screen w-60 bg-white border-r border-slate-200 flex flex-col z-[90] select-none',
        'transform transition-transform duration-200 lg:translate-x-0',
        open ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:shadow-none',
      )}
    >
      <div className="px-3 pt-3 pb-3 border-b border-slate-100 shrink-0 space-y-3">
        <div className="flex items-center gap-2.5 px-1">
          <img
            src={BRAND.logoSrc}
            alt={BRAND.name}
            className="w-8 h-8 rounded-xl object-contain shrink-0"
          />
          <div className="leading-tight min-w-0 flex-1">
            <p className="font-bold text-slate-900 text-sm tracking-tight truncate">{BRAND.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto lg:hidden text-slate-400 hover:text-slate-800 transition-colors rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-dna-500"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <WorkspaceSwitcher />
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="text-2xs font-bold uppercase tracking-widest px-2 mb-1 text-slate-400">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map(({ to, icon: Icon, label, end }, idx) => (
                <li key={`${group.label}-${label}-${idx}`}>
                  <NavLink
                    to={to}
                    end={end}
                    onClick={onClose}
                    className={() => {
                      const isActive = navActive(to, location.pathname, location.search, end);
                      return cn(
                        'group flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors duration-150',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-dna-500',
                        isActive
                          ? 'bg-dna-50 text-dna-700 border border-dna-100'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-transparent',
                      );
                    }}
                  >
                    {() => {
                      const isActive = navActive(to, location.pathname, location.search, end);
                      return (
                      <>
                        <Icon size={15} className={cn('shrink-0', isActive ? 'text-dna-600' : 'text-slate-400 group-hover:text-dna-600')} />
                        <span className="flex-1 text-[13px]">{label}</span>
                        {isActive && <ChevronRight size={11} className="text-dna-500 shrink-0" aria-hidden />}
                      </>
                      );
                    }}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <RecentProtectedNav onClose={onClose} />

        <div>
          <p className="text-2xs font-bold uppercase tracking-widest px-2 mb-1 text-slate-400">Account</p>
          <ul className="space-y-0.5">
            {ACCOUNT_LINKS.map(({ to, icon: Icon, label }) => (
              <li key={to}>
                  <NavLink
                  to={to}
                  onClick={onClose}
                  className={() => {
                    const isActive = navActive(to, location.pathname, location.search);
                    return cn(
                      'group flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-dna-500',
                      isActive
                        ? 'bg-dna-50 text-dna-700 border border-dna-100'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-transparent',
                    );
                  }}
                >
                  <Icon size={15} className="text-slate-400" />
                  <span className="text-[13px]">{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="shrink-0 p-3 border-t border-slate-100 space-y-2">
        {user && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
            <p className="text-2xs text-slate-400 font-medium">
              {isBusinessShell ? 'Business workspace' : 'Personal workspace'}
            </p>
            {subscription && (
              <p className="text-2xs text-slate-500 mt-0.5">{subscription.planName} plan</p>
            )}
          </div>
        )}
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
          <BackendStatus />
        </div>
      </div>
    </aside>
  );
}
