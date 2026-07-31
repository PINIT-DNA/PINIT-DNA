import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, Landmark, Archive, Dna,
  Award, Search, FileStack, Radar, Download, MapPin,
  Clock, Globe, BarChart3, ScrollText, Shield, Bell, LifeBuoy,
  Settings, Terminal, Sliders, Share2, ChevronLeft, LogOut,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const NAV = [
  { section: 'Overview' },
  { to: '/admin', label: 'Executive Dashboard', icon: LayoutDashboard, end: true },
  { section: 'Identity' },
  { to: '/admin/users', label: 'User Management', icon: Users },
  { to: '/admin/organizations', label: 'Organizations', icon: Building2 },
  { to: '/admin/institutions', label: 'Institutions', icon: Landmark },
  { section: 'Assets' },
  { to: '/admin/vault', label: 'Vault Explorer', icon: Archive },
  { to: '/admin/files', label: 'File Explorer', icon: FileStack },
  { to: '/admin/dna', label: 'DNA Engine', icon: Dna },
  { to: '/admin/certificates', label: 'Certificates', icon: Award },
  { section: 'Forensics' },
  { to: '/admin/investigations', label: 'Unified Investigation', icon: Search },
  { to: '/admin/evidence', label: 'Evidence Center', icon: FileStack },
  { to: '/admin/tracking', label: 'Access Intelligence', icon: MapPin },
  { to: '/admin/timeline', label: 'Timeline', icon: Clock },
  { section: 'Operations' },
  { to: '/admin/monitoring', label: 'Monitoring Center', icon: Radar },
  { to: '/admin/threats', label: 'Threat Center', icon: Shield },
  { to: '/admin/shares', label: 'Share Links', icon: Share2 },
  { to: '/admin/downloads', label: 'Protected Downloads', icon: Download },
  { to: '/admin/crawler', label: 'Crawler', icon: Globe },
  { section: 'Intelligence' },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/admin/reports', label: 'Reports', icon: ScrollText },
  { to: '/admin/audit', label: 'Audit Logs', icon: ScrollText },
  { section: 'System' },
  { to: '/admin/security', label: 'Security Center', icon: Shield },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell },
  { to: '/admin/support', label: 'Support', icon: LifeBuoy },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/developer', label: 'Developer Console', icon: Terminal },
  { to: '/admin/system', label: 'System Configuration', icon: Sliders },
];

export function SuperAdminSidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <aside
      className={`fixed left-0 top-0 z-50 h-[100dvh] w-64 bg-[#0c0c0e] border-r border-zinc-800 flex flex-col transform transition-transform duration-200 lg:translate-x-0 ${
        open ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:shadow-none'
      }`}
    >
      <div className="p-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-zinc-100 flex items-center justify-center">
            <span className="text-[10px] font-bold text-zinc-900">PA</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">PINIT Console</p>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Super Admin</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV.map((item, i) => {
          if ('section' in item && item.section) {
            return (
              <p key={`s-${i}`} className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">
                {item.section}
              </p>
            );
          }
          const { to, label, icon: Icon, end } = item as { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean };
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => onClose?.()}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`
              }
            >
              <Icon size={16} className="shrink-0 opacity-80" />
              <span className="truncate">{label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-3 border-t border-zinc-800 space-y-1">
        <button
          type="button"
          onClick={() => {
            onClose?.();
            navigate('/');
          }}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-zinc-100 bg-zinc-800 hover:bg-zinc-700 rounded-md border border-zinc-700"
          title="Leave Admin Console and return to your PinIT Hub dashboard"
        >
          <ChevronLeft size={16} />
          Back to User Dashboard
        </button>
        <div className="px-3 py-2 text-xs text-zinc-500 truncate">{user?.shortId}</div>
        <button
          type="button"
          onClick={() => logout()}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-red-400 hover:bg-zinc-900 rounded-md"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
