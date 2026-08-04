import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Shield, Bell, Clock, LogOut, Settings, HelpCircle, Sun, Moon, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../hooks/useTheme';
import { useUserProfile, isRealDisplayName, resolveDisplayName } from '../../hooks/useUserProfile';
import { isPlatformOwnerShortId } from '../../lib/platform-owner';

export function ProfileDropdown() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const { profile } = useUserProfile();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  const displayName = resolveDisplayName(profile?.fullName, user?.name);
  const labelName = isRealDisplayName(displayName) ? displayName : (profile?.shortId ?? user?.shortId ?? 'PINIT User');
  const initials = isRealDisplayName(displayName)
    ? displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : (profile?.shortId ?? user?.shortId ?? 'P').replace(/^PINIT-/i, '').slice(0, 2).toUpperCase() || 'P';

  function go(path: string) { setOpen(false); navigate(path); }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-8 h-8 rounded-full bg-gradient-to-br from-dna-500 to-purple flex items-center justify-center text-xs font-bold text-white select-none hover:ring-2 hover:ring-dna-400/50 transition-all"
      >
        {profile?.avatarUrl ? (
          <img src={profile.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
        ) : initials}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="dropdown-backdrop"
            aria-label="Close profile menu"
            onClick={() => setOpen(false)}
          />
          <div className="dropdown-panel w-full sm:w-72">
          {/* Header */}
          <div className="p-4 border-b border-bg-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-dna-500 to-purple flex items-center justify-center text-sm font-bold text-white shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{labelName}</p>
                <p className="text-2xs text-dna-400 font-mono">{profile?.shortId ?? (user as any)?.shortId ?? ''}</p>
                {profile?.email && <p className="text-2xs text-gray-500 truncate">{profile.email}</p>}
              </div>
            </div>
            {profile?.profileCompletion != null && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-2xs text-gray-500 mb-1">
                  <span>Profile Completion</span>
                  <span className="text-dna-400 font-semibold">{profile.profileCompletion}%</span>
                </div>
                <div className="w-full h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                  <div className="h-full bg-dna-500 rounded-full transition-all" style={{ width: `${profile.profileCompletion}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Menu */}
          <div className="py-1">
            <MenuItem icon={<User size={14} />} label="View Profile" onClick={() => go('/profile')} />
            <MenuItem icon={<Shield size={14} />} label="Security Settings" onClick={() => go('/profile?tab=security')} />
            <MenuItem icon={<Bell size={14} />} label="Notifications" onClick={() => go('/profile?tab=notifications')} />
            <MenuItem icon={<Clock size={14} />} label="Activity History" onClick={() => go('/profile?tab=activity')} />
            {isPlatformOwnerShortId(profile?.shortId ?? (user as { shortId?: string } | null)?.shortId) && (
              <MenuItem icon={<LayoutDashboard size={14} />} label="Admin Console" onClick={() => go('/admin')} />
            )}
            <MenuItem
              icon={theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              label={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              onClick={toggleTheme}
            />
            <MenuItem icon={<Settings size={14} />} label="Settings" onClick={() => go('/profile?tab=settings')} />
            <MenuItem icon={<HelpCircle size={14} />} label="Help & Support" onClick={() => window.open('mailto:support@pinitdna.com', '_blank')} />
          </div>

          {/* Footer */}
          <div className="border-t border-bg-border p-2">
            <button
              onClick={async () => { setOpen(false); await logout(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2 text-xs text-gray-400 hover:text-white hover:bg-bg-elevated transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}
