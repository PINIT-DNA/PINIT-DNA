'use client';

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';

/**
 * Content is visible at rest. Only blocks that start below the fold get a small
 * lift as they arrive. The check runs on scroll against the block's position,
 * so a block the visitor jumps past (menu link, End key, scrollbar drag) is
 * still revealed instead of staying hidden.
 */
export function Reveal({
  children,
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const reached = () => el.getBoundingClientRect().top < window.innerHeight * 0.9;
    if (reached()) return;
    el.classList.add('pre');
    let frame = 0;
    const cleanup = () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.clearTimeout(frame);
    };
    const check = () => {
      frame = 0;
      if (!reached()) return;
      el.classList.remove('pre');
      cleanup();
    };
    function onScroll() {
      if (!frame) frame = window.setTimeout(check, 60);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cleanup();
      el.classList.remove('pre');
    };
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} {...rest}>
      {children}
    </div>
  );
}
