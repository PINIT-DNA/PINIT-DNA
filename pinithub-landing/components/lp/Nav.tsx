'use client';

import { useEffect, useState } from 'react';
import { hubLoginUrl, hubSignupUrl } from '@/lib/site';

const LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#tracking', label: 'How it works' },
  { href: '#security', label: 'Security' },
  { href: '#who', label: 'Use cases' },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onResize = () => window.innerWidth > 960 && setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <header className="nav">
      <div className="lp-shell">
        <a className="logo" href="#top" aria-label="PINIT HUB home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-img" src="/brand/pinithub-emblem.png" width={34} height={34} alt="" />
          PINIT HUB
        </a>
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>{l.label}</a>
          ))}
        </nav>
        <div className="nav-cta">
          <a className="btn btn-ghost-ink" href={hubLoginUrl()}>Sign in</a>
          <a className="btn btn-primary" href={hubSignupUrl()}>Start free</a>
          <button
            type="button"
            className="nav-burger"
            aria-expanded={open}
            aria-controls="nav-sheet"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>
      {open ? (
        <nav id="nav-sheet" className="nav-sheet" aria-label="Mobile">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>
          ))}
          <a href={hubLoginUrl()}>Sign in</a>
        </nav>
      ) : null}
    </header>
  );
}
