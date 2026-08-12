import type { ReactNode } from 'react';

const TONES = {
  cyan: 'border-cyan/30 bg-cyan/10 text-cyan',
  blue: 'border-blue/30 bg-blue/10 text-blue',
  violet: 'border-violet/30 bg-violet/10 text-[#c4bbff]',
  green: 'border-signal/30 bg-signal/10 text-signal',
  amber: 'border-[color:var(--color-warn)]/35 bg-[color:var(--color-warn)]/10 text-[color:var(--color-warn)]',
  mute: 'border-line bg-white/[0.03] text-mute-2',
} as const;

export function Badge({
  children,
  tone = 'cyan',
  className = '',
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.14em] uppercase ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
