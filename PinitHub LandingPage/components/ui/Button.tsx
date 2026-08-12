'use client';

import type { ReactNode } from 'react';
import { MagneticButton } from '@/components/ui/MagneticButton';

type Variant = 'primary' | 'ghost' | 'quiet';

const BASE =
  'group relative inline-flex select-none items-center justify-center gap-2.5 rounded-full font-medium tracking-[-0.01em] transition-colors duration-300';

const SIZES = {
  md: 'h-11 px-6 text-[0.9375rem]',
  lg: 'h-[3.35rem] px-8 text-base',
} as const;

const VARIANTS: Record<Variant, string> = {
  primary: 'text-white',
  ghost: 'border border-line text-paper hover:border-cyan/40 hover:bg-white/[0.04]',
  quiet: 'text-mute hover:text-paper',
};

/**
 * Landing CTA.
 * Set `magnetic={false}` (or strength 0) for fixed chrome like the navbar —
 * magnetic drift reads as “floating” in a sticky header.
 */
export function Button({
  children,
  href,
  onClick,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ariaLabel,
  magnetic = true,
  strength,
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: Variant;
  size?: 'md' | 'lg';
  className?: string;
  type?: 'button' | 'submit';
  ariaLabel?: string;
  magnetic?: boolean;
  strength?: number;
}) {
  const resolvedStrength =
    strength ?? (magnetic ? (variant === 'quiet' ? 0.1 : 0.18) : 0);

  if (!magnetic || resolvedStrength <= 0) {
    const cls = `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`;
    const inner = (
      <>
        {variant === 'primary' ? (
          <>
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-[linear-gradient(100deg,#55E6FF_0%,#2D7BFF_42%,#6F5CFF_100%)]"
            />
            <span aria-hidden className="absolute inset-x-6 -top-px h-px rounded-full bg-white/50" />
          </>
        ) : null}
        <span className="relative z-10 inline-flex items-center gap-2.5">{children}</span>
      </>
    );

    if (href) {
      return (
        <a href={href} aria-label={ariaLabel} onClick={onClick} className={cls}>
          {inner}
        </a>
      );
    }

    return (
      <button type={type} onClick={onClick} aria-label={ariaLabel} className={cls}>
        {inner}
      </button>
    );
  }

  return (
    <MagneticButton
      href={href}
      onClick={onClick}
      variant={variant}
      size={size}
      className={className}
      type={type}
      ariaLabel={ariaLabel}
      strength={resolvedStrength}
    >
      {children}
    </MagneticButton>
  );
}
