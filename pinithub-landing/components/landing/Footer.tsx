'use client';

import { useState, type FormEvent } from 'react';
import { Logo } from '@/components/ui/Logo';
import { LANDING_FOOTER } from '@/lib/landing-content';
import { hubLoginUrl, hubSignupUrl } from '@/lib/site';

function resolveHref(href: string) {
  if (href === 'signup') return hubSignupUrl();
  if (href === 'login') return hubLoginUrl();
  return href;
}

export function LandingFooter() {
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
        setMessage(result?.message || 'Something went wrong. Try again.');
        return;
      }
      setState('done');
      setMessage('Subscribed. Thank you.');
      setEmail('');
    } catch {
      setState('error');
      setMessage('Network error. Try again.');
    }
  };

  return (
    <footer className="border-t border-line bg-ink-2">
      <div className="shell py-14 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)] lg:gap-16">
          <div>
            <Logo />
            <p className="mt-5 max-w-md text-[0.9375rem] leading-relaxed text-mute-2">
              {LANDING_FOOTER.tagline}
            </p>
            <form onSubmit={subscribe} className="mt-8 max-w-sm">
              <label htmlFor="landing-newsletter" className="eyebrow">
                Product updates
              </label>
              <div className="mt-3 flex gap-2">
                <input
                  id="landing-newsletter"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (state !== 'idle' && state !== 'pending') setState('idle');
                  }}
                  placeholder="you@company.com"
                  className="h-11 flex-1 rounded-full border border-line bg-ink px-4 text-sm text-paper outline-none focus:border-cyan/40"
                  autoComplete="email"
                />
                <button
                  type="submit"
                  disabled={state === 'pending'}
                  className="h-11 rounded-full border border-line bg-white/[0.04] px-4 text-sm text-paper transition-colors hover:border-cyan/35 disabled:opacity-55"
                >
                  {state === 'pending' ? '…' : 'Join'}
                </button>
              </div>
              {message ? (
                <p
                  className={`mt-2 text-[0.8125rem] ${state === 'error' ? 'text-[color:var(--color-danger)]' : 'text-signal'}`}
                  role="status"
                >
                  {message}
                </p>
              ) : null}
            </form>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {LANDING_FOOTER.columns.map((col) => (
              <div key={col.title}>
                <p className="eyebrow">{col.title}</p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={resolveHref(link.href)}
                        className="text-[0.9375rem] text-mute transition-colors hover:text-paper"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-12 border-t border-line pt-6 text-[0.8125rem] text-mute-2">
          © {new Date().getFullYear()} {LANDING_FOOTER.copyright}
        </p>
      </div>
    </footer>
  );
}
