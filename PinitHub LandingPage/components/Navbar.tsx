'use client';

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Logo } from './ui/Logo';
import { MagneticButton } from './ui/MagneticButton';

type NavItem = { id: string; label: string; href: string };

export function Navbar({
  links,
  ctaLabel,
}: {
  links: NavItem[];
  ctaLabel: string;
}) {
  const LINKS = links;
  const { scrollY } = useScroll();
  const [lifted, setLifted] = useState(false);
  const [open, setOpen] = useState(false);

  useMotionValueEvent(scrollY, 'change', (v) => setLifted(v > 24));

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <a
        href="#hero"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-full focus:bg-blue focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
        className="fixed inset-x-0 top-0 z-50"
      >
        <div
          className={`transition-[background-color,backdrop-filter,border-color,box-shadow] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            lifted
              ? 'border-b border-line bg-ink/70 shadow-[0_18px_50px_-30px_rgba(0,0,0,1)] backdrop-blur-xl backdrop-saturate-150'
              : 'border-b border-transparent bg-transparent'
          }`}
        >
          <nav aria-label="Primary" className="shell flex h-14 min-h-[3.5rem] items-center justify-between gap-3 sm:h-[4.5rem] sm:gap-6">
            <a href="#hero" className="shrink-0 min-w-0" aria-label="PINITHUB home">
              <Logo compact />
            </a>

            <ul className="hidden items-center gap-1 lg:flex">
              {LINKS.map((l) => (
                <li key={l.id}>
                  <a
                    href={l.href}
                    className="group relative block rounded-full px-4 py-2 text-[0.9375rem] text-mute transition-colors duration-300 hover:text-paper"
                  >
                    {l.label}
                    <span className="pointer-events-none absolute inset-x-4 -bottom-0.5 h-px origin-left scale-x-0 bg-[linear-gradient(90deg,#55E6FF,#2D7BFF)] transition-transform duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-x-100" />
                  </a>
                </li>
              ))}
            </ul>

            <div className="hidden items-center gap-2 lg:flex">
              <MagneticButton href="#demo">
                {ctaLabel}
                <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </MagneticButton>
            </div>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
              className="grid h-11 w-11 place-items-center rounded-full border border-line text-paper transition-colors hover:bg-white/5 lg:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </nav>
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-nav"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-40 bg-ink/95 backdrop-blur-2xl lg:hidden"
          >
            <div className="lattice absolute inset-0 opacity-40" aria-hidden />
            <div className="shell relative flex h-full flex-col pt-28 pb-10">
              <ul className="flex flex-col gap-1">
                {LINKS.map((l, i) => (
                  <motion.li
                    key={l.id}
                    initial={{ opacity: 0, y: 22 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.06 * i + 0.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <a
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className="flex items-baseline justify-between border-b border-line py-5 font-display text-3xl font-medium tracking-[-0.04em] text-paper"
                    >
                      {l.label}
                      <span className="eyebrow text-cyan/60">{String(i + 1).padStart(2, '0')}</span>
                    </a>
                  </motion.li>
                ))}
              </ul>
              <div className="mt-auto pt-10">
                <MagneticButton href="#demo" size="lg" className="w-full" onClick={() => setOpen(false)}>
                  {ctaLabel}
                  <ArrowUpRight className="h-4 w-4" />
                </MagneticButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
