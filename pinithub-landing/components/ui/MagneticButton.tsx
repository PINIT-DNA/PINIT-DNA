'use client';

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import type { ReactNode, MouseEvent } from 'react';
import { useCallback, useRef } from 'react';

type Variant = 'primary' | 'ghost' | 'quiet';

const BASE =
  'group relative inline-flex select-none items-center justify-center gap-2.5 rounded-full font-medium tracking-[-0.01em] transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-55';

const SIZES = {
  md: 'h-11 px-6 text-[0.9375rem]',
  lg: 'h-[3.35rem] px-8 text-base',
} as const;

const VARIANTS: Record<Variant, string> = {
  primary: 'text-white',
  ghost: 'border border-line text-paper hover:border-cyan/40 hover:bg-white/[0.04]',
  quiet: 'text-mute hover:text-paper',
};

export function MagneticButton({
  children,
  href,
  onClick,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ariaLabel,
  disabled,
  strength = 0.32,
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: Variant;
  size?: keyof typeof SIZES;
  className?: string;
  type?: 'button' | 'submit';
  ariaLabel?: string;
  disabled?: boolean;
  strength?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 260, damping: 18, mass: 0.35 });
  const y = useSpring(my, { stiffness: 260, damping: 18, mass: 0.35 });
  // Inner content trails the shell slightly, which reads as depth rather than a slide.
  const cx = useTransform(x, (v) => v * 0.42);
  const cy = useTransform(y, (v) => v * 0.42);

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (reduce || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      mx.set((e.clientX - (r.left + r.width / 2)) * strength);
      my.set((e.clientY - (r.top + r.height / 2)) * strength);
    },
    [mx, my, reduce, strength],
  );

  const onLeave = useCallback(() => {
    mx.set(0);
    my.set(0);
  }, [mx, my]);

  const content = (
    <>
      {variant === 'primary' && (
        <>
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-[linear-gradient(100deg,#55E6FF_0%,#2D7BFF_42%,#6F5CFF_100%)]"
          />
          {/* Specular sheen that sweeps once on hover */}
          <span
            aria-hidden
            className="absolute inset-0 overflow-hidden rounded-full [mask-image:linear-gradient(#000,#000)]"
          >
            <span className="absolute inset-y-0 -left-full w-1/2 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent)] transition-[left] duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:left-[150%]" />
          </span>
          <span
            aria-hidden
            className="absolute -inset-[3px] -z-10 rounded-full bg-[linear-gradient(100deg,#55E6FF,#2D7BFF,#6F5CFF)] opacity-0 blur-lg transition-opacity duration-500 group-hover:opacity-70"
          />
          <span
            aria-hidden
            className="absolute inset-x-6 -top-px h-px rounded-full bg-white/60"
          />
        </>
      )}
      <motion.span
        style={reduce ? undefined : { x: cx, y: cy }}
        className="relative z-10 inline-flex items-center gap-2.5"
      >
        {children}
      </motion.span>
    </>
  );

  const cls = `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`;
  const style = reduce ? undefined : { x, y };

  if (href) {
    return (
      <motion.a
        ref={ref as React.RefObject<HTMLAnchorElement>}
        href={href}
        aria-label={ariaLabel}
        onClick={onClick}
        className={cls}
        style={style}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        whileTap={{ scale: 0.97 }}
      >
        {content}
      </motion.a>
    );
  }

  return (
    <motion.button
      ref={ref as React.RefObject<HTMLButtonElement>}
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cls}
      style={style}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      whileTap={{ scale: 0.97 }}
    >
      {content}
    </motion.button>
  );
}
