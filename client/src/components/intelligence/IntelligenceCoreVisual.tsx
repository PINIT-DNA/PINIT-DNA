import { ShieldCheck, Image as ImageIcon, FileText, File, Globe, Search, Sparkles } from 'lucide-react';

const NODES = [
  { icon: ImageIcon, angle: -90,  tone: 'blue' },
  { icon: FileText,  angle: -30,  tone: 'purple' },
  { icon: Globe,     angle: 30,   tone: 'cyan' },
  { icon: File,      angle: 90,   tone: 'green' },
  { icon: Search,    angle: 150,  tone: 'amber' },
  { icon: Sparkles,  angle: 210,  tone: 'purple' },
] as const;

const RADIUS = 42;

function pos(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { left: `${50 + RADIUS * Math.cos(rad)}%`, top: `${50 + RADIUS * Math.sin(rad)}%` };
}

/**
 * Premium 3D-style AI intelligence core for the /pinit-hub/investigation
 * ("Intelligence") pre-upload workspace. Entirely decorative (aria-hidden),
 * built from CSS/SVG + lucide icons only — no canvas/three.js, no fabricated
 * analysis data. Nothing here changes appearance based on real state because
 * there is no report yet at the point it renders (see UnifiedInvestigationPage.tsx,
 * which only mounts this before `report` exists).
 */
export function IntelligenceCoreVisual() {
  return (
    <div className="ic-stage" aria-hidden="true">
      <div className="ic-glow ic-glow--blue" />
      <div className="ic-glow ic-glow--violet" />

      <div className="ic-ring ic-ring--outer" />
      <div className="ic-ring ic-ring--inner" />
      <div className="ic-scan" />

      <svg className="ic-lines" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        {NODES.map((n, i) => {
          const p = pos(n.angle);
          return (
            <line
              key={i}
              x1={parseFloat(p.left)}
              y1={parseFloat(p.top)}
              x2={50}
              y2={50}
              className="ic-line"
              style={{ animationDelay: `${i * 0.45}s` }}
            />
          );
        })}
      </svg>

      <div className="ic-particles">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={`ic-particle ic-particle--${i % 4}`} />
        ))}
      </div>

      {NODES.map(({ icon: Icon, angle, tone }, i) => {
        const p = pos(angle);
        return (
          <div key={i} className={`ic-node ic-node--${tone}`} style={{ left: p.left, top: p.top }}>
            <Icon size={14} />
          </div>
        );
      })}

      <div className="ic-core">
        <span className="ic-core-pulse ic-core-pulse--1" />
        <span className="ic-core-pulse ic-core-pulse--2" />
        <div className="ic-core-shield">
          <ShieldCheck size={32} strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}
