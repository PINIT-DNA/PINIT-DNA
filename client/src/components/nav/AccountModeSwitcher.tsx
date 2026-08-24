import { useState } from 'react';
import { Building2, Store, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../ui/utils';
import { useAccountViewMode } from '../../hooks/useAccountViewMode';
import { openHubExchange } from '../../lib/open-exchange';

/** Top-of-dashboard Individual | Business | Exchange — same face, different prefix. */
export function AccountModeSwitcher({ className }: { className?: string }) {
  const { mode, switching, switchTo, canSwitch } = useAccountViewMode();
  const [openingExchange, setOpeningExchange] = useState(false);

  if (!canSwitch) return null;

  const openExchange = async () => {
    if (openingExchange) return;
    setOpeningExchange(true);
    try {
      const { pinitId } = await openHubExchange();
      toast.success(`Opening Exchange as ${pinitId}`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err instanceof Error ? err.message : 'Could not open Exchange');
      toast.error(msg);
    } finally {
      setOpeningExchange(false);
    }
  };

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
            ? 'bg-dna-500 text-white border border-dna-600 shadow-sm'
            : 'text-slate-600 hover:text-slate-900 border border-transparent dark:text-gray-300 dark:hover:text-white',
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
            ? 'bg-dna-500 text-white border border-dna-600 shadow-sm'
            : 'text-slate-600 hover:text-slate-900 border border-transparent dark:text-gray-300 dark:hover:text-white',
        )}
      >
        <Building2 size={13} />
        <span>Business</span>
      </button>
      <button
        type="button"
        disabled={switching || openingExchange}
        onClick={() => void openExchange()}
        className={cn(
          'flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-2xs sm:text-xs font-semibold transition-colors disabled:opacity-60',
          openingExchange
            ? 'bg-dna-500 text-white border border-dna-600 shadow-sm'
            : 'text-slate-600 hover:text-slate-900 border border-transparent dark:text-gray-300 dark:hover:text-white',
        )}
        title="Same face, Exchange ID PINIT-EX-…"
      >
        <Store size={13} />
        <span>{openingExchange ? 'Opening…' : 'Exchange'}</span>
      </button>
    </div>
  );
}
