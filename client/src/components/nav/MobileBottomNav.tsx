import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Dna, ShieldCheck, Archive, Menu, Building2 } from 'lucide-react';
import { cn } from '../ui/utils';
import { BRAND } from '../../config/brand.config';
import { useAccountViewMode } from '../../hooks/useAccountViewMode';

interface Props {
  onOpenMenu: () => void;
}

export function MobileBottomNav({ onOpenMenu }: Props) {
  const location = useLocation();
  const { isBusinessShell } = useAccountViewMode();

  const homeTo = isBusinessShell ? '/business' : '/';
  const HomeIcon = isBusinessShell ? Building2 : LayoutDashboard;

  const tabs = [
    { to: homeTo, icon: HomeIcon, label: 'Home', end: true as const },
    { to: '/generate', icon: Dna, label: 'Protect' },
    { to: BRAND.investigationPath, icon: ShieldCheck, label: 'Investigate' },
    { to: '/vault', icon: Archive, label: 'Assets' },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[85] lg:hidden border-t border-bg-border bg-bg-card/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Primary navigation"
    >
      <div className="grid grid-cols-5 h-14">
        {tabs.map(({ to, icon: Icon, label, end }) => {
          const active = end
            ? location.pathname === to
            : location.pathname === to || location.pathname.startsWith(`${to}/`);

          return (
            <NavLink
              key={`${label}-${to}`}
              to={to}
              end={end}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 min-h-[56px] touch-manipulation relative',
                active ? 'text-dna-500' : 'text-gray-500',
              )}
            >
              <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
              <span className={cn('text-[10px] font-semibold leading-none', active && 'text-dna-500')}>
                {label}
              </span>
            </NavLink>
          );
        })}

        <button
          type="button"
          onClick={onOpenMenu}
          className="flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-gray-500 touch-manipulation"
          aria-label="Open menu"
        >
          <Menu size={20} strokeWidth={1.75} />
          <span className="text-[10px] font-semibold leading-none">More</span>
        </button>
      </div>
    </nav>
  );
}
