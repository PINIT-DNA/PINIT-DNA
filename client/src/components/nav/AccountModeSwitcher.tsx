import { Building2, User } from 'lucide-react';
import { cn } from '../ui/utils';
import { useAccountViewMode } from '../../hooks/useAccountViewMode';

/** Top-of-dashboard Individual | Business switcher */
export function AccountModeSwitcher({ className }: { className?: string }) {
  const { mode, switching, switchTo, canSwitch } = useAccountViewMode();

  if (!canSwitch) return null;

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-xl border border-bg-border bg-bg-elevated p-0.5 shrink-0',
        className,
      )}
      role="group"
      aria-label="Switch account dashboard"
    >
      <button
        type="button"
        disabled={switching}
        onClick={() => void switchTo('INDIVIDUAL')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-2xs sm:text-xs font-semibold transition-colors disabled:opacity-60',
          mode === 'INDIVIDUAL'
            ? 'bg-dna-500/20 text-white border border-dna-500/40 shadow-sm'
            : 'text-gray-500 hover:text-white border border-transparent',
        )}
      >
        <User size={13} />
        <span>Individual</span>
      </button>
      <button
        type="button"
        disabled={switching}
        onClick={() => void switchTo('BUSINESS')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-2xs sm:text-xs font-semibold transition-colors disabled:opacity-60',
          mode === 'BUSINESS'
            ? 'bg-dna-500/20 text-white border border-dna-500/40 shadow-sm'
            : 'text-gray-500 hover:text-white border border-transparent',
        )}
      >
        <Building2 size={13} />
        <span>Business</span>
      </button>
    </div>
  );
}
