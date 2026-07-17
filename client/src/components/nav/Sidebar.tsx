import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Dna, Shield, Archive, FileSearch,
  Award, ChevronRight, Zap, Clock,
  ShieldCheck, Activity, Microscope, Radio, Ban, LogOut, User, X,
  Sun, Moon,
} from 'lucide-react';
import { cn } from '../ui/utils';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../hooks/useTheme';
import { API_BASE_URL } from '../../config/api.config';
import { BRAND } from '../../config/brand.config';

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
      window.clearTimeout(id);
    };
  }, []);

  const isOnline = online === true;
  const isChecking = online === null;

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <span className={cn(
          'w-1.5 h-1.5 rounded-full',
          isChecking && 'bg-yellow-400 animate-pulse',
          isOnline && 'bg-success animate-pulse-slow',
          online === false && 'bg-danger',
        )} />
        <span className="text-xs text-gray-400 font-medium">
          {isChecking ? 'Checking API…' : isOnline ? 'System Online' : 'Backend Offline'}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-2xs text-gray-600 mono">
        <Zap size={10} className={isOnline ? 'text-dna-500' : 'text-danger'} />
        <span>
          {isChecking
            ? (isProd ? 'Connecting to Render API…' : 'Connecting to localhost:4000')
            : isOnline
              ? 'All systems operational'
              : (isProd ? 'API waking up — refresh in a moment' : 'Run npm run dev:all')}
        </span>
      </div>
    </>
  );
}

const NAV_GROUPS = [
  {
    label: 'Core',
    items: [
      { to: '/',          icon: LayoutDashboard, label: 'Dashboard',     end: true },
      { to: '/generate',  icon: Dna,             label: 'Generate DNA'             },
    ],
  },
  {
    label: 'Explorer',
    items: [
      { to: '/vault',       icon: Archive,    label: 'Vault Explorer' },
      { to: '/dna-records', icon: FileSearch, label: 'DNA Records'    },
      { to: '/timeline',    icon: Clock,      label: 'File Timeline'  },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/access-intelligence', icon: Activity, label: 'Access Intelligence' },
      { to: '/forensic-diff',       icon: Microscope, label: 'Difference Engine'    },
      { to: '/monitoring',          icon: Radio,      label: 'Monitoring & Crawler' },
    ],
  },
  {
    label: 'Forensics',
    items: [
      { to: BRAND.investigationPath, icon: ShieldCheck, label: 'Unified Investigation' },
      { to: '/reports',             icon: Shield,      label: 'Forensic Reports'    },
      { to: '/unmask-requests',     icon: Shield,      label: 'Unmask Requests'     },
      { to: '/duplicate-attempts',  icon: Ban,         label: 'Duplicate Attempts'  },
      { to: '/vault-integrity',     icon: Activity,    label: 'Vault Integrity'     },
    ],
  },
  {
    label: 'Sharing',
    items: [
      { to: '/certificates',        icon: Award,       label: 'Certificates'        },
      { to: '/verify-certificate',  icon: ShieldCheck, label: 'Verify Certificate'  },
    ],
  },
];

const NAV_GROUP_COLORS: Record<string, string> = {
  Core: 'text-indigo-500',
  Explorer: 'text-violet-500',
  Intelligence: 'text-cyan-600',
  Forensics: 'text-rose-500',
  Sharing: 'text-amber-600',
};

interface SidebarProps {
  /** Drawer open state (mobile/APK only). */
  open?: boolean;
  /** Close the drawer (mobile/APK only). */
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen w-60 bg-white/85 dark:bg-bg-surface/95 backdrop-blur-xl border-r border-bg-border flex flex-col z-50 select-none',
        // Off-canvas drawer on mobile; always docked from lg up (desktop web unchanged).
        'transform transition-transform duration-200 lg:translate-x-0',
        open ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:shadow-none'
      )}
    >

      {/* Logo */}
      <div className="h-14 flex items-center gap-3 px-5 border-b border-bg-border shrink-0 bg-white/60 dark:bg-bg-elevated/40">
        <img
          src={BRAND.logoSrc}
          alt={BRAND.name}
          className="w-8 h-8 rounded-xl object-contain shrink-0"
        />
        <div className="leading-none min-w-0">
          <p className="font-bold text-white text-sm tracking-tight truncate">
            {BRAND.name}
          </p>
          <p className="text-2xs text-gray-500 mono mt-0.5 truncate">{BRAND.version}</p>
        </div>
        {/* Close button — mobile drawer only */}
        <button
          onClick={onClose}
          className="ml-auto lg:hidden text-gray-500 hover:text-white transition-colors"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <p className={cn('text-2xs font-bold uppercase tracking-widest px-2 mb-1', NAV_GROUP_COLORS[group.label] ?? 'text-gray-500')}>
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map(({ to, icon: Icon, label, end }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={end}
                    onClick={onClose}
                    className={({ isActive }) => cn(
                      'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'bg-gradient-to-r from-dna-500/15 via-indigo-500/10 to-transparent text-dna-600 dark:text-dna-400 border border-dna-200/60 dark:border-dna-500/30 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-dna-700 dark:hover:text-white hover:bg-dna-50/70 dark:hover:bg-bg-elevated border border-transparent'
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={15} className={cn('shrink-0', isActive ? 'text-dna-500' : 'text-gray-400 group-hover:text-dna-500')} />
                        <span className="flex-1 text-[13px]">{label}</span>
                        {isActive && <ChevronRight size={11} className="text-dna-500 shrink-0" />}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Status footer */}
      <div className="shrink-0 p-3 border-t border-bg-border space-y-2">
        {/* User identity */}
        {user && (
          <div className="rounded-xl bg-bg-elevated border border-bg-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-full bg-dna-500/20 flex items-center justify-center shrink-0">
                  <User size={11} className="text-dna-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xs text-gray-500 font-medium leading-none mb-0.5">Logged in as</p>
                  <p className="text-xs text-dna-400 font-bold truncate mono">{(user as any).shortId ?? user.sub?.slice(0,8)}</p>
                </div>
              </div>
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="shrink-0 text-gray-500 hover:text-dna-400 transition-colors"
              >
                {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
              </button>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="shrink-0 text-gray-500 hover:text-red-400 transition-colors"
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-bg-elevated border border-bg-border p-3">
          <BackendStatus />
        </div>
      </div>
    </aside>
  );
}
