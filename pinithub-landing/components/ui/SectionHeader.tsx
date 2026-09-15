import type { ReactNode } from 'react';

export function SectionHeader({
  index,
  label,
  title,
  lede,
  align = 'left',
  className = '',
  children,
}: {
  index?: string;
  label: string;
  title: string;
  lede?: string;
  align?: 'left' | 'center';
  className?: string;
  children?: ReactNode;
}) {
  const centered = align === 'center';
  return (
    <header className={`max-w-3xl ${centered ? 'mx-auto text-center' : ''} ${className}`}>
      <div className={`flex items-center gap-3 ${centered ? 'justify-center' : ''}`}>
        {index ? <span className="eyebrow text-cyan/70">{index}</span> : null}
        <span className="eyebrow">{label}</span>
      </div>
      <h2 className="mt-5 font-display text-[clamp(1.75rem,4.2vw,3rem)] leading-[1.08] font-semibold tracking-[-0.035em] text-paper">
        {title}
      </h2>
      {lede ? (
        <p className={`mt-5 text-[1.0625rem] leading-relaxed text-mute ${centered ? 'mx-auto max-w-2xl' : 'max-w-2xl'}`}>
          {lede}
        </p>
      ) : null}
      {children}
    </header>
  );
}
