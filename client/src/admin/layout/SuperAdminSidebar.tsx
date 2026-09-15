import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, Boxes, ShieldCheck, ShoppingCart,
  CreditCard, Coins, Share2, Globe2, Fingerprint, LifeBuoy,
  BarChart3, Settings2, ChevronLeft, LogOut,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAdminCapabilities } from '../context/AdminCapabilitiesContext';
import { fetchSystemHealth } from '../api/super-admin.api';
import type { AdminDomain } from '../api/super-admin.api';

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; domain: AdminDomain }[] = [
  { to: '/admin', label: 'Command Center', icon: LayoutDashboard, end: true, domain: 'overview' },
  { to: '/admin/users', label: 'Users', icon: Users, domain: 'identity' },
  { to: '/admin/organizations', label: 'Organizations', icon: Building2, domain: 'identity' },
  { to: '/admin/dna', label: 'Assets & DNA', icon: Boxes, domain: 'assets' },
  { to: '/admin/investigations', label: 'Intelligence (Sentinel)', icon: ShieldCheck, domain: 'forensics' },
  { to: '/admin/marketplace', label: 'Marketplace (Exchange)', icon: ShoppingCart, domain: 'commerce' },
  { to: '/admin/billing', label: 'Billing & Subscriptions', icon: CreditCard, domain: 'commerce' },
  { to: '/admin/credits', label: 'Credits & Usage', icon: Coins, domain: 'commerce' },
  { to: '/admin/network', label: 'Network Intelligence', icon: Share2, domain: 'intelligence' },
  { to: '/admin/monitoring', label: 'Web Intelligence / Crawler', icon: Globe2, domain: 'operations' },
  { to: '/admin/verification', label: 'Identity & Verification', icon: Fingerprint, domain: 'identity' },
  { to: '/admin/support', label: 'Support & Disputes', icon: LifeBuoy, domain: 'system' },
  { to: '/admin/analytics', label: 'Reports & Analytics', icon: BarChart3, domain: 'intelligence' },
  { to: '/admin/settings', label: 'System & Settings', icon: Settings2, domain: 'system' },
];

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  ANALYST: 'Analyst',
  AUDITOR: 'Auditor',
  USER: 'User',
};

type HealthComponent = { status?: string };
type HealthReport = { status?: string; components?: Record<string, HealthComponent> };

export function SuperAdminSidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { role, isOwner, capabilities } = useAdminCapabilities();
  const [health, setHealth] = useState<HealthReport | null>(null);

  useEffect(() => {
    fetchSystemHealth().then((h) => setHealth(h as HealthReport)).catch(() => setHealth(null));
  }, []);

  const nav = NAV.filter((item) => isOwner || capabilities.includes(item.domain));

  const components = health?.components ?? {};
  const componentEntries = Object.entries(components);
  const healthyCount = componentEntries.filter(([, c]) => c.status === 'healthy').length;
  const allHealthy = componentEntries.length > 0 && healthyCount === componentEntries.length;

  return (
    <aside
      className={`fixed left-0 top-0 z-50 h-[100dvh] w-72 bg-white border-r border-gray-200 flex flex-col transform transition-transform duration-200 lg:translate-x-0 ${
        open ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:shadow-none'
      }`}
    >
      <div className="h-16 shrink-0 flex items-center gap-2.5 px-5 border-b border-gray-100">
        <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-white">P</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-tight truncate">PinitHUB</p>
          <p className="text-[11px] text-gray-500 leading-tight">Master Admin</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => onClose?.()}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`
            }
          >
            <Icon size={17} className="shrink-0" />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="px-3 pb-3">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${allHealthy ? 'bg-emerald-500' : componentEntries.length ? 'bg-amber-500' : 'bg-gray-300'}`} />
              <span className="text-xs font-medium text-gray-700">System Health</span>
            </div>
            <span className="text-[10px] text-gray-400">
              {health ? (allHealthy ? 'All Operational' : `${healthyCount}/${componentEntries.length} Operational`) : '—'}
            </span>
          </div>
          <div className="space-y-1">
            {componentEntries.slice(0, 4).map(([key, c]) => (
              <div key={key} className="flex items-center justify-between text-[11px]">
                <span className="text-gray-500 capitalize">{key}</span>
                <span className={c.status === 'healthy' ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                  {c.status === 'healthy' ? 'OK' : c.status ?? '—'}
                </span>
              </div>
            ))}
            {!componentEntries.length && <p className="text-[11px] text-gray-400">Loading…</p>}
          </div>
        </div>
      </div>

      <div className="p-3 border-t border-gray-100 space-y-1">
        <div className="flex items-center justify-between px-1 py-1">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-indigo-50 text-[11px] font-medium text-indigo-700">
            <span className={`w-1.5 h-1.5 rounded-full ${isOwner ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {ROLE_LABEL[role] ?? role}
          </span>
          <span className="text-[10px] text-gray-400" title={isOwner ? 'Full access — platform owner' : `${capabilities.length} of 8 domains granted`}>
            {isOwner ? 'Full access' : `${capabilities.length}/8 domains`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            onClose?.();
            navigate('/');
          }}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg"
          title="Leave Admin Console and return to your Pinit HUB dashboard"
        >
          <span className="flex items-center gap-2"><ChevronLeft size={16} /> Back to Dashboard</span>
        </button>
        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
            <span className="text-[11px] font-bold text-white">{(user?.shortId ?? 'MA').slice(-2)}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-gray-900 truncate">{ROLE_LABEL[role] ?? 'Admin'}</p>
            <p className="text-[11px] text-gray-500 truncate">{user?.shortId}</p>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md shrink-0"
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
