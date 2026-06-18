import { ReactNode } from 'react';
import { Fingerprint } from 'lucide-react';

interface AuthShellProps {
  /** Total steps in the flow — renders the progress rail when > 0. */
  steps?: number;
  /** Current step index (0-based). */
  current?: number;
  tagline?: string;
  children: ReactNode;
}

/**
 * Premium dark shell for the PINIT HOID auth flows. Owns the brand mark and the
 * step-progress rail; everything is scoped under `.pinit-auth` so the app-wide
 * light theme never bleeds in.
 */
export function AuthShell({ steps = 0, current = 0, tagline = 'Human Origin Identity', children }: AuthShellProps) {
  return (
    <div className="pinit-auth">
      <div className="pa-shell">
        <div className="pa-brand">
          <div className="pa-logo">
            <Fingerprint size={22} color="#fff" />
          </div>
          <div style={{ lineHeight: 1.05 }}>
            <div style={{ fontWeight: 800, fontSize: 20, color: '#0f172a', letterSpacing: '-0.02em' }}>PINIT</div>
            <div className="pa-faint" style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              {tagline}
            </div>
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
  );
}
