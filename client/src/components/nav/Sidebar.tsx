import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Dna, Shield, Archive, FileSearch,
  GitCompare, Award, ChevronRight, Zap, Clock,
  ShieldCheck, Activity, Microscope, Radio, Ban, LogOut, User, ShieldAlert, X,
  Sun, Moon,
} from 'lucide-react';
import { cn } from '../ui/utils';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../hooks/useTheme';

const NAV_GROUPS = [
  {
    label: 'Core',
    items: [
      { to: '/',          icon: LayoutDashboard, label: 'Dashboard',     end: true },
      { to: '/generate',  icon: Dna,             label: 'Generate DNA'             },
      { to: '/compare',   icon: GitCompare,      label: 'DNA Compare'              },
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
      { to: '/unified-investigation', icon: ShieldCheck, label: 'Unified Investigation' },
      { to: '/verify-leaked',         icon: FileSearch,  label: 'Verify Leaked File'  },
      { to: '/forensic-dashboard',  icon: ShieldAlert, label: 'Forensic Dashboard'  },
      { to: '/security-center',     icon: ShieldAlert, label: 'Security Center'     },
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
        'fixed left-0 top-0 h-screen w-60 bg-bg-surface border-r border-bg-border flex flex-col z-50 select-none',
        // Off-canvas drawer on mobile; always docked from lg up (desktop web unchanged).
        'transform transition-transform duration-200 lg:translate-x-0',
        open ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:shadow-none'
      )}
    >

      {/* Logo */}
      <div className="h-14 flex items-center gap-3 px-5 border-b border-bg-border shrink-0">
        <div className="w-7 h-7 rounded-lg bg-dna-500 flex items-center justify-center shadow-glow-purple">
          <Dna size={14} className="text-white" />
        </div>
        <div className="leading-none">
          <p className="font-bold text-white text-sm tracking-tight">
            PINIT<span className="text-dna-400">-DNA</span>
          </p>
          <p className="text-2xs text-gray-500 mono mt-0.5">v2.0 · Universal</p>
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
            <p className="text-2xs font-semibold text-gray-600 uppercase tracking-widest px-2 mb-1">
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
                      'group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'bg-dna-500/15 text-dna-400'
                        : 'text-gray-400 hover:text-white hover:bg-bg-elevated'
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={15} className={cn('shrink-0', isActive ? 'text-dna-400' : 'text-gray-500 group-hover:text-gray-300')} />
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
          <div className="flex items-center gap-2 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-slow" />
            <span className="text-xs text-gray-400 font-medium">System Online</span>
          </div>
          <div className="flex items-center gap-1.5 text-2xs text-gray-600 mono">
            <Zap size={10} className="text-dna-500" />
            <span>10 file types · 15 DNA layers</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
