'use client';

import type { ReactNode } from 'react';
import { Reveal, RevealWords } from './Reveal';

/**
 * Editorial section header. The index number and hairline rule are the page's
 * recurring structural motif, so every section reads as part of one document.
 */
export function SectionHeading({
  index,
  label,
  title,
  lede,
  align = 'left',
  className = '',
  titleClassName = '',
}: {
  index: string;
  label: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'left' | 'center';
  className?: string;
  titleClassName?: string;
}) {
  const centered = align === 'center';

  return (
    <header className={`${centered ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'} ${className}`}>
      <Reveal>
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${centered ? 'justify-center' : ''}`}>
          <span className="eyebrow shrink-0 text-cyan/80">{index}</span>
          <span aria-hidden className="h-px w-6 shrink-0 bg-[linear-gradient(90deg,rgba(85,230,255,0.6),transparent)] sm:w-8" />
          <span className="eyebrow">{label}</span>
        </div>
      </Reveal>

      {typeof title === 'string' ? (
        <RevealWords
          text={title}
          delay={0.06}
          className={`mt-6 text-[clamp(1.65rem,5.5vw,3.5rem)] leading-[1.08] font-semibold text-glow ${titleClassName}`}
        />
      ) : (
        <Reveal delay={0.06}>
          <h2 className={`mt-6 text-[clamp(1.65rem,5.5vw,3.5rem)] leading-[1.08] font-semibold ${titleClassName}`}>
            {title}
          </h2>
        </Reveal>
      )}

      {lede && (
        <Reveal delay={0.14}>
          <p className={`mt-5 text-[0.9375rem] leading-relaxed text-mute sm:mt-6 sm:text-[1.0625rem] ${centered ? 'mx-auto' : ''} max-w-2xl`}>
            {lede}
          </p>
        </Reveal>
      )}
    </header>
  );
}
