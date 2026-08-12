'use client';

import { ArrowRight, Check } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { SiteContent } from '@/lib/content';
import { icon as resolveIcon } from '@/lib/icons';
import { Logo } from './ui/Logo';

export function Footer({
  content,
  settings,
}: {
  content: SiteContent['footer'];
  settings: SiteContent['settings'];
}) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'pending' | 'error' | 'done'>('idle');
  const [message, setMessage] = useState('');

  const subscribe = async (e: FormEvent) => {
    e.preventDefault();
    if (state === 'pending') return;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setState('error');
      setMessage('Enter a valid email address.');
      return;
    }

    setState('pending');
    try {
      const response = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'footer' }),
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        setState('error');
        setMessage(result?.error ?? 'Something went wrong. Please try again.');
        return;
      }

      setState('done');
      setMessage('You are subscribed. Welcome aboard.');
      setEmail('');
    } catch {
      setState('error');
      setMessage('We could not reach the server. Please try again.');
    }
  };

  return (
    <footer className="relative overflow-hidden border-t border-line">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-ink" />
        <div className="lattice absolute inset-0 opacity-30" />
        <div className="aura bottom-[-40%] left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 bg-blue/12" />
      </div>

      {/* Lifecycle strip: the page's thesis, restated one last time */}
      <div className="border-b border-line overflow-x-auto">
        <div className="shell flex w-max min-w-full items-center justify-start gap-x-3 gap-y-2 py-5 sm:w-auto sm:flex-wrap sm:justify-center sm:py-6">
          {content.lifecycle.map((s, i) => (
            <span key={s} className="flex items-center gap-3">
              <span className="font-mono text-[0.6875rem] tracking-[0.18em] text-mute-2 uppercase transition-colors duration-300 hover:text-cyan whitespace-nowrap">
                {s}
              </span>
              {i < content.lifecycle.length - 1 && (
                <span aria-hidden className="h-1 w-1 rounded-full bg-cyan/40" />
              )}
            </span>
          ))}
        </div>
      </div>

      <div className="shell py-16 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)] lg:gap-16">
          {/* Brand + newsletter */}
          <div>
            <a href="#hero" aria-label="PINITHUB home">
              <Logo />
            </a>
            <p className="mt-6 max-w-sm text-[0.9375rem] leading-relaxed text-mute-2">
              {settings.footerTagline}
            </p>

            <form onSubmit={subscribe} className="mt-8 max-w-sm" noValidate>
              <label htmlFor="newsletter" className="eyebrow block">
                {settings.newsletterLabel}
              </label>
              <div className="mt-3 flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="newsletter"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (state !== 'idle') setState('idle');
                    }}
                    placeholder="you@company.com"
                    aria-invalid={state === 'error'}
                    aria-describedby={state === 'error' ? 'newsletter-error' : undefined}
                    className={`w-full rounded-full border bg-white/[0.03] px-5 py-3 text-[0.9375rem] text-paper outline-none transition-all duration-300 placeholder:text-mute-2/55 ${
                      state === 'error'
                        ? 'border-red-400/60'
                        : 'border-line focus:border-cyan/45 focus:shadow-[0_0_0_4px_rgba(85,230,255,0.09)]'
                    }`}
                  />
                </div>
                <button
                  type="submit"
                  disabled={state === 'pending'}
                  aria-label="Subscribe to the newsletter"
                  className="group grid h-[3.0625rem] w-[3.0625rem] shrink-0 place-items-center rounded-full bg-[linear-gradient(100deg,#55E6FF,#2D7BFF)] text-ink transition-transform duration-300 hover:scale-105 active:scale-95 disabled:opacity-60"
                >
                  {state === 'done' ? (
                    <Check className="h-4.5 w-4.5" strokeWidth={2.5} />
                  ) : (
                    <ArrowRight className="h-4.5 w-4.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                  )}
                </button>
              </div>
              <p
                id="newsletter-error"
                role={state === 'error' ? 'alert' : undefined}
                className={`mt-2.5 text-[0.8125rem] ${
                  state === 'error' ? 'text-red-400' : state === 'done' ? 'text-signal' : 'text-mute-2/70'
                }`}
              >
                {message || settings.newsletterHint}
              </p>
            </form>
          </div>

          {/* Navigation */}
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
            {content.columns.map((col) => (
              <div key={col.title}>
                <h3 className="font-display text-[0.9375rem] font-medium text-paper">{col.title}</h3>
                <ul className="mt-5 space-y-3">
                  {col.links.map((l) => (
                    <li key={`${col.title}-${l.label}`}>
                      <a
                        href={l.href}
                        className="group inline-flex items-center gap-1.5 text-[0.875rem] text-mute-2 transition-colors duration-300 hover:text-paper"
                      >
                        <span className="h-px w-0 bg-cyan transition-all duration-300 group-hover:w-2.5" />
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Base */}
        <div className="mt-16 flex flex-col gap-6 border-t border-line pt-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <p className="text-[0.8125rem] text-mute-2">
              © {new Date().getFullYear()} {settings.copyrightName}. All rights reserved.
            </p>
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              {content.legal.map((l) => (
                <li key={l.id}>
                  <a
                    href={l.href}
                    className="text-[0.8125rem] text-mute-2 underline-offset-4 transition-colors hover:text-paper hover:underline"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <ul className="flex gap-2">
            {content.socials.map((s) => {
              const Icon = resolveIcon(s.platform);
              return (
                <li key={s.id}>
                  <a
                    href={s.href}
                    aria-label={s.label}
                    className="grid h-10 w-10 place-items-center rounded-full border border-line text-mute-2 transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-cyan/40 hover:bg-white/[0.05] hover:text-cyan"
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.7} />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Wordmark watermark */}
      <div aria-hidden className="relative overflow-hidden">
        <p className="shell -mb-[0.18em] translate-y-[0.12em] font-display text-[clamp(3.5rem,15vw,13rem)] leading-none font-bold tracking-[-0.05em] whitespace-nowrap text-white/[0.028] select-none">
          PINITHUB
        </p>
      </div>
    </footer>
  );
}
