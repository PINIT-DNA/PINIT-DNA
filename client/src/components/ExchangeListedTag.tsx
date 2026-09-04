import { Store } from 'lucide-react';
import { cn } from './ui/utils';

export function ExchangeListedTag({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      title="Listed on Pinit Exchange"
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-500/90 text-black font-semibold shadow-sm',
        compact ? 'px-1 py-0.5 text-[9px] leading-none' : 'px-1.5 py-0.5 text-2xs',
        className,
      )}
    >
      <Store size={compact ? 9 : 11} strokeWidth={2.4} />
      Exchange
    </span>
  );
}
