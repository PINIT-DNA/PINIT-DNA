'use client';

import { useEffect, useRef } from 'react';

type Particle = {
  x: number;
  y: number;
  z: number; // depth 0..1, drives size, alpha and parallax
  vx: number;
  vy: number;
  r: number;
  hue: 0 | 1 | 2;
};

const TINTS = ['rgba(85,230,255,', 'rgba(45,123,255,', 'rgba(111,92,255,'] as const;

/**
 * Ambient dust field on a canvas. Cheaper and softer than DOM particles.
 * Pauses when scrolled out of view, and renders one static frame when the
 * visitor prefers reduced motion.
 */
export function ParticleField({
  density = 0.00009,
  className = '',
  speed = 1,
  parallax = true,
  connect = false,
}: {
  density?: number;
  className?: string;
  speed?: number;
  parallax?: boolean;
  connect?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let raf = 0;
    let visible = true;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    const seed = () => {
      const count = Math.min(220, Math.max(40, Math.round(width * height * density)));
      particles = Array.from({ length: count }, () => {
        const z = Math.random();
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          z,
          vx: (Math.random() - 0.5) * 0.18 * speed * (0.4 + z),
          vy: (-0.08 - Math.random() * 0.22) * speed * (0.4 + z),
          r: 0.5 + z * 1.6,
          hue: (Math.floor(Math.random() * 3) as 0 | 1 | 2),
        };
      });
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      pointer.x += (pointer.tx - pointer.x) * 0.045;
      pointer.y += (pointer.ty - pointer.y) * 0.045;

      for (const p of particles) {
        if (!reduce) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.y < -10) {
            p.y = height + 10;
            p.x = Math.random() * width;
          }
          if (p.x < -10) p.x = width + 10;
          if (p.x > width + 10) p.x = -10;
        }

        const ox = parallax ? pointer.x * (0.2 + p.z * 0.9) : 0;
        const oy = parallax ? pointer.y * (0.2 + p.z * 0.9) : 0;
        const alpha = 0.12 + p.z * 0.5;

        ctx.beginPath();
        ctx.arc(p.x + ox, p.y + oy, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `${TINTS[p.hue]}${alpha})`;
        ctx.fill();
      }

      if (connect) {
        // Only near-field particles link up, so the lattice stays sparse.
        const near = particles.filter((p) => p.z > 0.55);
        for (let i = 0; i < near.length; i++) {
          for (let j = i + 1; j < near.length; j++) {
            const a = near[i];
            const b = near[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 15000) {
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.strokeStyle = `rgba(85,230,255,${0.09 * (1 - d2 / 15000)})`;
              ctx.lineWidth = 0.6;
              ctx.stroke();
            }
          }
        }
      }

      if (!reduce && visible) raf = requestAnimationFrame(draw);
    };

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 26;
      pointer.ty = ((e.clientY - rect.top) / rect.height - 0.5) * 26;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        cancelAnimationFrame(raf);
        if (visible) raf = requestAnimationFrame(draw);
      },
      { rootMargin: '120px' },
    );
    io.observe(canvas);

    resize();
    raf = requestAnimationFrame(draw);
    if (parallax && !reduce) window.addEventListener('pointermove', onPointer, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onPointer);
    };
  }, [connect, density, parallax, speed]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
