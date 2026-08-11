'use client';

import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import type { MouseEvent, ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';

/**
 * Panel with cursor-tracked lighting and a restrained 3D tilt.
 * The glow follows the pointer; the tilt is capped low so text stays readable.
 */
export function TiltCard({
  children,
  className = '',
  maxTilt = 6,
  glow = 'rgba(45,123,255,0.16)',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  maxTilt?: number;
  glow?: string;
  as?: 'div' | 'article' | 'li';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [hovered, setHovered] = useState(false);

  const px = useMotionValue(50);
  const py = useMotionValue(50);
  const rx = useSpring(useMotionValue(0), { stiffness: 200, damping: 22 });
  const ry = useSpring(useMotionValue(0), { stiffness: 200, damping: 22 });

  const spotlight = useMotionTemplate`radial-gradient(420px circle at ${px}% ${py}%, ${glow}, transparent 62%)`;

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      px.set(nx * 100);
      py.set(ny * 100);
      if (!reduce) {
        ry.set((nx - 0.5) * maxTilt * 2);
        rx.set(-(ny - 0.5) * maxTilt * 2);
      }
    },
    [maxTilt, px, py, reduce, rx, ry],
  );

  const onLeave = useCallback(() => {
    setHovered(false);
    rx.set(0);
    ry.set(0);
    px.set(50);
    py.set(50);
  }, [px, py, rx, ry]);

  // Runtime picks the real tag; the cast just keeps the ref/props union tractable.
  const MotionTag = motion[Tag] as typeof motion.div;

  return (
    <MotionTag
      ref={ref}
      className={`panel grain group relative overflow-hidden transition-[box-shadow,border-color,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-white/15 hover:shadow-[var(--shadow-lift-hi)] ${className}`}
      style={
        reduce
          ? undefined
          : { rotateX: rx, rotateY: ry, transformPerspective: 1200, transformStyle: 'preserve-3d' }
      }
      onMouseMove={onMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={onLeave}
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{ background: spotlight }}
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      />
      <span className="relative z-10 block h-full [transform:translateZ(28px)]">{children}</span>
    </MotionTag>
  );
}
