'use client';

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/ui/Logo';
import { LANDING_NAV } from '@/lib/landing-content';
import { hubLoginUrl, hubSignupUrl } from '@/lib/site';

export function LandingNavbar() {
  const { scrollY } = useScroll();
  const [lifted, setLifted] = useState(false);
  const [open, setOpen] = useState(false);
  const signup = hubSignupUrl();
  const login = hubLoginUrl();

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
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-full focus:bg-blue focus:px-5 focus:py-2.5 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      <header className="fixed inset-x-0 top-0 z-50 overflow-hidden">
        <div
          className={`transition-[background-color,backdrop-filter,border-color] duration-500 ${
            lifted
              ? 'border-b border-line bg-ink/80 backdrop-blur-xl'
              : 'border-b border-transparent bg-ink/40 backdrop-blur-md'
          }`}
        >
          <nav
            aria-label="Primary"
            className="shell flex h-14 items-center gap-3 sm:h-16 sm:gap-4"
          >
            <a href="#hero" className="shrink-0" aria-label="PINITHUB home">
              <Logo compact />
            </a>

            <ul className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex">
              {LANDING_NAV.map((l) => (
                <li key={l.id}>
                  <a
                    href={l.href}
                    className="whitespace-nowrap rounded-full px-3 py-2 text-[0.875rem] text-mute transition-colors hover:text-paper"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>

            <div className="ml-auto hidden shrink-0 items-center gap-3 md:flex lg:ml-0">
              <a
                href={login}
                className="whitespace-nowrap px-2 py-2 text-[0.9375rem] text-mute transition-colors hover:text-paper"
              >
                Log in
              </a>
              <a
                href={signup}
                className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[linear-gradient(100deg,#E879F9_0%,#6D5EF0_45%,#A855F7_100%)] px-5 text-[0.9375rem] font-medium text-white"
              >
                Get started
                <ArrowUpRight className="h-4 w-4" aria-hidden />
              </a>
            </div>

            <button
              type="button"
              className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-paper md:hidden"
              aria-expanded={open}
              aria-controls="landing-mobile-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </nav>
        </div>
      </header>

      <AnimatePresence>
        {open ? (
          <motion.div
            id="landing-mobile-nav"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-ink/95 backdrop-blur-xl md:hidden"
          >
            <div className="shell flex h-full flex-col pt-24 pb-10">
              <ul className="flex flex-col gap-1">
                {LANDING_NAV.map((l) => (
                  <li key={l.id}>
                    <a
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className="block border-b border-line py-4 font-display text-2xl text-paper"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-3">
                <a
                  href={signup}
                  onClick={() => setOpen(false)}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(100deg,#E879F9_0%,#6D5EF0_45%,#A855F7_100%)] text-base font-medium text-white"
                >
                  Get started
                </a>
                <a
                  href={login}
                  onClick={() => setOpen(false)}
                  className="inline-flex h-12 w-full items-center justify-center rounded-full border border-line text-base text-paper"
                >
                  Log in
                </a>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
