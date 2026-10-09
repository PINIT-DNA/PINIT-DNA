import type { CSSProperties } from 'react';
import { ShieldCheck, FileText, Image as ImageIcon, Lock, CheckCircle2, Search, Fingerprint } from 'lucide-react';

/**
 * Premium 3D-style forensic visual for the Evidence ("/reports") empty state only.
 * Pure CSS/SVG + lucide icons — no external image assets, no new dependencies.
 * Scoped entirely under the `evi-` class prefix (see index.css) so it cannot
 * affect any other page's styling. Purely decorative: no data, no text content,
 * no functional behavior — the "No evidence yet" copy and action buttons stay
 * in ReportsPage.tsx exactly as they were.
 */
const BADGES: Array<{
  icon: typeof FileText;
  tone: 'blue' | 'purple' | 'green' | 'orange';
  className: string;
}> = [
  { icon: ImageIcon, tone: 'blue', className: 'evi-badge--tl' },
  { icon: FileText, tone: 'purple', className: 'evi-badge--tr' },
  { icon: Lock, tone: 'blue', className: 'evi-badge--ml' },
  { icon: CheckCircle2, tone: 'green', className: 'evi-badge--mr' },
  { icon: Search, tone: 'orange', className: 'evi-badge--bl' },
  { icon: Fingerprint, tone: 'purple', className: 'evi-badge--br' },
];

const PARTICLES = Array.from({ length: 12 }, (_, i) => i);

export function EvidenceEmptyVisual() {
  return (
    <div className="evi-stage" aria-hidden="true">
      <div className="evi-glow evi-glow--blue" />
      <div className="evi-glow evi-glow--purple" />

      <svg className="evi-lines" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid meet">
        <line x1="80" y1="60" x2="200" y2="130" className="evi-line" style={{ animationDelay: '0s' }} />
        <line x1="320" y1="60" x2="200" y2="130" className="evi-line" style={{ animationDelay: '0.6s' }} />
        <line x1="60" y1="150" x2="200" y2="130" className="evi-line" style={{ animationDelay: '1.2s' }} />
        <line x1="340" y1="150" x2="200" y2="130" className="evi-line" style={{ animationDelay: '1.8s' }} />
        <line x1="110" y1="220" x2="200" y2="130" className="evi-line" style={{ animationDelay: '2.4s' }} />
        <line x1="290" y1="220" x2="200" y2="130" className="evi-line" style={{ animationDelay: '3s' }} />
      </svg>

      <div className="evi-particles">
        {PARTICLES.map((i) => (
          <span key={i} className={`evi-particle evi-particle--${i % 4}`} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>

      {BADGES.map(({ icon: Icon, tone, className }, i) => (
        <div key={i} className={`evi-badge evi-badge--${tone} ${className}`}>
          <Icon size={16} />
        </div>
      ))}

      <div className="evi-shield">
        <div className="evi-shield-ring" />
        <div className="evi-shield-core">
          <ShieldCheck size={40} strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}
