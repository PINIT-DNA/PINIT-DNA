import { ReactNode } from 'react';
import { Bell, Sun, Moon } from 'lucide-react';
import { useTheme } from '../theme';

/** Shared top bar for app screens — title, tagline, theme toggle, bell. */
export function AppHeader({ icon, title, tagline }: { icon?: ReactNode; title: string; tagline: string }) {
  const { mode, toggle } = useTheme();
  return (
    <div className="pa-top">
      {icon && <div className="pa-logo">{icon}</div>}
      <div style={{ flex: 1 }}>
        <div className="pa-title">{title}</div>
        <div className="pa-sub">{tagline}</div>
      </div>
      <button className="pa-icon-btn" onClick={toggle} aria-label="Toggle theme">
        {mode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <button className="pa-icon-btn"><Bell size={18} /></button>
    </div>
  );
}
