import { ShieldCheck, Globe, PlayCircle, Code2, MessageCircle, Send } from 'lucide-react';

export interface MonitoringHeroVisualProps {
  /** Real monitoring-enabled state (stats.monitoringEnabled) — drives pulse color
   * and whether the orbit/scan animations play at full intensity. Never fabricated. */
  live: boolean;
  /** Real per-platform readiness (stats.readiness.platforms) — each node dims or
   * brightens based on whether that platform is actually ready, same booleans
   * already shown in the "Monitoring readiness" panel below this visual. */
  platforms?: {
    website: boolean;
    youtube: boolean;
    github: boolean;
    reddit: boolean;
    telegram: boolean;
  };
}

const NODES = [
  { key: 'website',  label: 'WEBSITE',  icon: Globe,         angle: -90 },
  { key: 'youtube',  label: 'YOUTUBE',  icon: PlayCircle,    angle: -18 },
  { key: 'github',   label: 'GITHUB',   icon: Code2,         angle: 54 },
  { key: 'reddit',   label: 'REDDIT',   icon: MessageCircle, angle: 126 },
  { key: 'telegram', label: 'TELEGRAM', icon: Send,          angle: 198 },
] as const;

const RADIUS = 42;

function nodePos(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    left: `${50 + RADIUS * Math.cos(rad)}%`,
    top: `${50 + RADIUS * Math.sin(rad)}%`,
  };
}

/**
 * Premium 3D-style live monitoring centerpiece for the /monitoring hero.
 * Entirely decorative (aria-hidden) — purely CSS/SVG, no canvas/three.js,
 * no fabricated data. The only two things that change its appearance are
 * real application state: `live` and `platforms`, both passed in from
 * MonitoringPage's existing `stats` response.
 */
export function MonitoringHeroVisual({ live, platforms }: MonitoringHeroVisualProps) {
  return (
    <div className={`mc-stage ${live ? 'mc-stage--live' : 'mc-stage--paused'}`} aria-hidden="true">
      <div className="mc-glow mc-glow--blue" />
      <div className="mc-glow mc-glow--purple" />

      <div className="mc-ring mc-ring--outer" />
      <div className="mc-ring mc-ring--inner" />
      <div className="mc-scan" />

      <svg className="mc-lines" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        {NODES.map((n, i) => {
          const p = nodePos(n.angle);
          const ready = platforms ? platforms[n.key] : undefined;
          return (
            <line
              key={n.key}
              x1={parseFloat(p.left)}
              y1={parseFloat(p.top)}
              x2={50}
              y2={50}
              className={`mc-line ${ready === false ? 'mc-line--dim' : ''}`}
              style={{ animationDelay: `${i * 0.5}s` }}
            />
          );
        })}
      </svg>

      <div className="mc-particles">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={`mc-particle mc-particle--${i % 5}`} />
        ))}
      </div>

      {NODES.map((n) => {
        const Icon = n.icon;
        const p = nodePos(n.angle);
        const ready = platforms ? platforms[n.key] : undefined;
        return (
          <div
            key={n.key}
            className={`mc-node ${ready === false ? 'mc-node--dim' : 'mc-node--ready'}`}
            style={{ left: p.left, top: p.top }}
          >
            <Icon size={14} />
            <span className="mc-node-label">{n.label}</span>
          </div>
        );
      })}

      <div className="mc-core">
        <span className="mc-core-pulse mc-core-pulse--1" />
        <span className="mc-core-pulse mc-core-pulse--2" />
        <div className="mc-core-shield">
          <ShieldCheck size={30} strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}
