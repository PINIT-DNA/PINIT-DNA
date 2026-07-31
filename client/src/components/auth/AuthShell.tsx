import { ReactNode } from 'react';
import { BRAND } from '../../config/brand.config';

interface AuthShellProps {
  /** Total steps in the flow — renders the progress rail when > 0. */
  steps?: number;
  /** Current step index (0-based). */
  current?: number;
  tagline?: string;
  children: ReactNode;
}

/**
 * Enterprise dark shell for PinIT Hub biometric auth.
 * Biometric-only — no email/password UI.
 */
export function AuthShell({
  steps = 0,
  current = 0,
  tagline = BRAND.tagline,
  children,
}: AuthShellProps) {
  return (
    <div className="pinit-auth">
      <div className="pa-bg" aria-hidden>
        <span className="pa-orb pa-orb-a" />
        <span className="pa-orb pa-orb-b" />
        <span className="pa-grid" />
      </div>

      <div className="pa-layout">
        <aside className="pa-hero">
          <div className="pa-brand pa-brand-hero">
            <img src={BRAND.logoSrc} alt={BRAND.name} className="pa-logo-img" />
            <div>
              <div className="pa-brand-name">{BRAND.name}</div>
              <div className="pa-brand-tag">{tagline}</div>
            </div>
          </div>
          <h2 className="pa-hero-title">Create. Protect. Manage.</h2>
          <p className="pa-hero-copy">
            Enterprise biometric identity — face, fingerprint, and voice. No passwords.
          </p>
          <ul className="pa-hero-list">
            <li>Military-grade presence verification</li>
            <li>Immutable DNA-backed identity</li>
            <li>Tracked access &amp; share control</li>
          </ul>
        </aside>

        <div className="pa-shell">
          <div className="pa-brand pa-brand-mobile">
            <img src={BRAND.logoSrc} alt={BRAND.name} className="pa-logo-img" />
            <div>
              <div className="pa-brand-name">{BRAND.name}</div>
              <div className="pa-brand-tag">{tagline}</div>
            </div>
          </div>

          {steps > 0 && (
            <div className="pa-rail" aria-hidden>
              {Array.from({ length: steps }).map((_, i) => (
                <span key={i} className={i < current ? 'done' : i === current ? 'on' : ''} />
              ))}
            </div>
          )}

          {children}
        </div>
      </div>
    </div>
  );
}
