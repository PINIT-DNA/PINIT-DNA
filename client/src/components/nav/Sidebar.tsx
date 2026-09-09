import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard, Shield, FileSearch,
  Award, ChevronDown, Bell,
  Radio, X,
  CreditCard, Settings, Users, Briefcase,
  HelpCircle, FolderKanban, ClipboardCheck, Activity,
  User, Share2, FileText,
} from 'lucide-react';
import { cn } from '../ui/utils';
import { useAuth } from '../../context/AuthContext';
import { useSubscription, FeatureKey } from '../../hooks/useSubscription';
import { useAccountViewMode } from '../../hooks/useAccountViewMode';
import { API_BASE_URL } from '../../config/api.config';
import { BRAND } from '../../config/brand.config';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

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
    const id = window.setInterval(check, 90_000);
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

type NavGroup = {
  label: string;
  items: NavItem[];
};

const GROUP_ICON: Record<string, typeof LayoutDashboard> = {
  Protect: Shield,
  Watch: Radio,
  Intelligence: FileSearch,
  Share: Share2,
  Work: Briefcase,
  Account: User,
};

const PERSONAL_NAV: NavGroup[] = [
  {
    label: 'Protect',
    items: [
      { to: '/generate', icon: Shield, label: 'Protect New' },
      { to: '/vault', icon: FolderKanban, label: 'My Assets' },
    ],
  },
  {
    label: 'Watch',
    items: [
      { to: '/monitoring', icon: Radio, label: 'Monitoring', feature: FeatureKey.FEATURE_TRACKING },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: BRAND.investigationPath, icon: FileSearch, label: 'Intelligence', feature: FeatureKey.FEATURE_INVESTIGATION },
      { to: '/reports', icon: FileText, label: 'Evidence', feature: FeatureKey.FEATURE_INVESTIGATION },
    ],
  },
    {
      label: 'Share',
      items: [
        { to: '/access-intelligence', icon: Share2, label: 'Sharing' },
        { to: '/timeline', icon: Activity, label: 'Asset Activity' },
        { to: '/certificates', icon: Award, label: 'Credentials' },
      ],
    },
];

const BUSINESS_NAV: NavGroup[] = [
  {
    label: 'Protect',
    items: [
      { to: '/generate', icon: Shield, label: 'Protect New' },
      { to: '/business/clients', icon: Briefcase, label: 'Clients' },
      { to: '/business', icon: FolderKanban, label: 'Campaigns' },
      { to: '/vault', icon: FolderKanban, label: 'My Assets' },
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
    label: 'Watch',
    items: [
      { to: '/monitoring', icon: Radio, label: 'Monitoring', feature: FeatureKey.FEATURE_TRACKING },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: BRAND.investigationPath, icon: FileSearch, label: 'Intelligence', feature: FeatureKey.FEATURE_INVESTIGATION },
      { to: '/reports', icon: FileText, label: 'Evidence', feature: FeatureKey.FEATURE_INVESTIGATION },
    ],
  },
    {
      label: 'Share',
      items: [
        { to: '/access-intelligence', icon: Share2, label: 'Sharing' },
        { to: '/timeline', icon: Activity, label: 'Asset Activity' },
        { to: '/certificates', icon: Award, label: 'Credentials' },
      ],
    },
];

const ACCOUNT_LINKS: NavItem[] = [
  { to: '/profile', icon: User, label: 'Profile' },
  { to: '/profile?tab=portfolio', icon: Briefcase, label: 'Portfolio' },
  { to: '/profile?tab=settings', icon: Settings, label: 'Settings' },
  { to: '/profile?tab=notifications', icon: Bell, label: 'Notifications' },
  { to: '/upgrade', icon: Award, label: 'Plans' },
  { to: '/subscription', icon: CreditCard, label: 'Billing' },
  { to: '/help', icon: HelpCircle, label: 'Help' },
];

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
  if (path === '/profile' && !query) {
    const tab = new URLSearchParams(search).get('tab');
    return pathname === '/profile' && tab !== 'notifications' && tab !== 'settings' && tab !== 'portfolio';
  }
  if (end) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function groupHasActive(items: NavItem[], pathname: string, search: string) {
  return items.some((item) => navActive(item.to, pathname, search, item.end));
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const { user } = useAuth();
  const { subscription } = useSubscription();
  const { isBusinessShell } = useAccountViewMode();
  const location = useLocation();
  const homeTo = isBusinessShell ? '/business' : '/';
  const homeActive = navActive(homeTo, location.pathname, location.search, true);

  const navGroups = useMemo<NavGroup[]>(
    () => [
      ...(isBusinessShell ? BUSINESS_NAV : PERSONAL_NAV),
      { label: 'Account', items: ACCOUNT_LINKS },
    ],
    [isBusinessShell],
  );

  const activeGroupLabel = useMemo(
    () => navGroups.find((group) => groupHasActive(group.items, location.pathname, location.search))?.label ?? null,
    [navGroups, location.pathname, location.search],
  );

  const [openGroup, setOpenGroup] = useState<string | null>(homeActive ? null : activeGroupLabel);
  const routeKey = `${location.pathname}${location.search}`;
  const lastRouteKey = useRef(routeKey);

  useEffect(() => {
    if (lastRouteKey.current === routeKey) return;
    lastRouteKey.current = routeKey;
    if (homeActive) {
      setOpenGroup(null);
      return;
    }
    if (activeGroupLabel) setOpenGroup(activeGroupLabel);
  }, [routeKey, activeGroupLabel, homeActive]);

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

      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-1">
        <p className="px-3 pt-1 pb-1 text-[10px] font-semibold tracking-[0.14em] uppercase text-slate-400">Core</p>
        <NavLink
          to={homeTo}
          end
          onClick={() => {
            setOpenGroup(null);
            onClose?.();
          }}
          className={() =>
            cn(
              'group flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-dna-500',
              homeActive
                ? 'bg-dna-50 text-dna-700 border border-dna-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-transparent',
            )
          }
        >
          <LayoutDashboard size={15} className={cn('shrink-0', homeActive ? 'text-dna-600' : 'text-slate-400')} />
          <span className="text-[13px]">Home</span>
        </NavLink>
        {navGroups.map((group) => {
          const GroupIcon = GROUP_ICON[group.label] ?? LayoutDashboard;
          const isOpen = openGroup === group.label;
          const childActive = groupHasActive(group.items, location.pathname, location.search);
          const panelId = `sidebar-${group.label.toLowerCase()}-links`;

          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => setOpenGroup((current) => (current === group.label ? null : group.label))}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className={cn(
                  'w-full group flex items-center gap-3 px-3 py-2 rounded-xl transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-dna-500',
                  isOpen || childActive
                    ? 'text-slate-900 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100',
                )}
              >
                <GroupIcon size={15} className={cn('shrink-0', isOpen || childActive ? 'text-dna-600' : 'text-slate-400')} />
                <span className="flex-1 text-left text-[11px] font-semibold tracking-[0.12em] uppercase">{group.label}</span>
                <ChevronDown
                  size={14}
                  className={cn(
                    'shrink-0 text-slate-400 transition-transform duration-150',
                    isOpen && 'rotate-180',
                  )}
                  aria-hidden
                />
              </button>
              {isOpen && (
                <ul id={panelId} className="mt-0.5 ml-3 pl-3 border-l border-slate-200/70 dark:border-white/10 space-y-0.5">
                  {group.items.map(({ to, icon: Icon, label, end }, idx) => (
                    <li key={`${group.label}-${label}-${idx}`}>
                      <NavLink
                        to={to}
                        end={end}
                        onClick={onClose}
                        className={() => {
                          const isActive = navActive(to, location.pathname, location.search, end);
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
              )}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 p-3 border-t border-slate-200/80 dark:border-white/10 space-y-2">
        {user && (
          <div className="rounded-xl px-3 py-2">
            <p className="text-[12px] text-slate-500 font-medium">
              {isBusinessShell ? 'Business' : 'Personal'}
            </p>
            {subscription && (
              <p className="text-[12px] text-slate-500 mt-0.5">{subscription.planName} plan</p>
            )}
          </div>
        )}
        <div className="rounded-xl px-3 py-2">
          <BackendStatus />
        </div>
      </div>
    </aside>
  );
}
