import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Dna, Archive, ShieldAlert, User } from 'lucide-react';

const TABS = [
  { to: '/',              label: 'Home',       icon: Home },
  { to: '/app/dna',       label: 'DNA',        icon: Dna },
  { to: '/app/vault',     label: 'Vault',      icon: Archive },
  { to: '/app/forensics', label: 'Forensics',  icon: ShieldAlert },
  { to: '/app/profile',   label: 'Profile',    icon: User },
];

/** Bottom navigation for the native app (APK only). */
export function TabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="pa-tabs">
      {TABS.map(({ to, label, icon: Icon }) => {
        const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
        return (
          <button key={to} className={`pa-tab${active ? ' active' : ''}`} onClick={() => navigate(to)}>
            <Icon size={21} strokeWidth={active ? 2.4 : 2} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
