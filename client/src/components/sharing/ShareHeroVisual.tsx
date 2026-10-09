import { ShieldCheck, Image as ImageIcon, FileText, Video, User, Link2, MapPin } from 'lucide-react';

const NODES = [
  { icon: ImageIcon, angle: -90,  tone: 'blue' },
  { icon: FileText,  angle: -30,  tone: 'purple' },
  { icon: Video,     angle: 30,   tone: 'cyan' },
  { icon: User,      angle: 90,   tone: 'green' },
  { icon: Link2,     angle: 150,  tone: 'amber' },
  { icon: MapPin,    angle: 210,  tone: 'purple' },
] as const;

const RADIUS = 42;

function pos(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { left: `${50 + RADIUS * Math.cos(rad)}%`, top: `${50 + RADIUS * Math.sin(rad)}%` };
}

/**
 * Premium 3D-style secure-sharing core for the /access-intelligence
 * ("Sharing") page hero. Entirely decorative (aria-hidden), CSS/SVG only —
 * no fabricated activity data. `live` reflects real state (whether any
 * share link in the current tab is actually active) so the pulse never
 * claims activity that isn't real.
 */
export function ShareHeroVisual({ live }: { live: boolean }) {
  return (
    <div className={`shr-stage ${live ? 'shr-stage--live' : 'shr-stage--idle'}`} aria-hidden="true">
      <div className="shr-glow shr-glow--blue" />
      <div className="shr-glow shr-glow--violet" />

      <div className="shr-ring shr-ring--outer" />
      <div className="shr-ring shr-ring--inner" />

      <svg className="shr-lines" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        {NODES.map((n, i) => {
          const p = pos(n.angle);
          return (
            <line
              key={i}
              x1={parseFloat(p.left)}
              y1={parseFloat(p.top)}
              x2={50}
              y2={50}
              className="shr-line"
              style={{ animationDelay: `${i * 0.45}s` }}
            />
          );
        })}
      </svg>

      <div className="shr-particles">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className={`shr-particle shr-particle--${i % 4}`} />
        ))}
      </div>

      {NODES.map(({ icon: Icon, angle, tone }, i) => {
        const p = pos(angle);
        return (
          <div key={i} className={`shr-node shr-node--${tone}`} style={{ left: p.left, top: p.top }}>
            <Icon size={14} />
          </div>
        );
      })}

      <div className="shr-core">
        <span className="shr-core-pulse shr-core-pulse--1" />
        <span className="shr-core-pulse shr-core-pulse--2" />
        <div className="shr-core-shield">
          <ShieldCheck size={30} strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}
