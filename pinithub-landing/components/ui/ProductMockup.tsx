import type { ReactNode } from 'react';

/**
 * Chrome frame for product UI mockups — looks like a Hub panel, not decorative art.
 */
export function ProductMockup({
  title,
  children,
  className = '',
  eyebrow = 'PinIT Hub',
}: {
  title: string;
  children: ReactNode;
  className?: string;
  eyebrow?: string;
}) {
  return (
    <figure
      className={`overflow-hidden rounded-[var(--radius-xl)] border border-line bg-ink-2 shadow-[var(--shadow-lift)] ${className}`}
      aria-label={`${title} product preview`}
    >
      <figcaption className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          </span>
          <span className="truncate text-[0.8125rem] text-mute">{title}</span>
        </div>
        <span className="eyebrow shrink-0 text-[0.6rem]">{eyebrow}</span>
      </figcaption>
      <div className="relative bg-[linear-gradient(180deg,rgba(11,23,41,0.9),rgba(5,8,22,0.95))] p-4 sm:p-5">
        <div className="lattice-fine pointer-events-none absolute inset-0 opacity-30" aria-hidden />
        <div className="relative">{children}</div>
      </div>
    </figure>
  );
}
