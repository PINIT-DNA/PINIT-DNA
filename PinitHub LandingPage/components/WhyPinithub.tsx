'use client';

import { motion } from 'framer-motion';
import type { SectionChrome, SiteContent } from '@/lib/content';
import { RevealGroup, RevealItem } from './ui/Reveal';
import { SectionHeading } from './ui/SectionHeading';
import { TiltCard } from './ui/TiltCard';

/** Stored by key so the copy can be edited without losing the illustration. */
const ART: Record<string, () => React.JSX.Element> = {
  fragment: FragmentArt,
  horizon: HorizonArt,
  network: NetworkArt,
};

export function WhyPinithub({
  section,
  cards,
}: {
  section: SectionChrome;
  cards: SiteContent['why'];
}) {
  return (
    <section id="why" className="relative scroll-mt-24 overflow-hidden section-pad">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#050816,#070d1f_45%,#050816)]" />
        <div className="aura top-[12%] left-[40%] h-[34rem] w-[34rem] bg-blue/10" />
      </div>

      <div className="shell">
        <SectionHeading
          index={section.index}
          label={section.label}
          title={section.title}
          lede={section.lede}
        />

        <RevealGroup className="mt-16 grid gap-5 lg:mt-20 lg:grid-cols-3" stagger={0.1}>
          {cards.map((c) => {
            const Art = ART[c.artKey];
            return (
            <RevealItem key={c.id}>
              <TiltCard glow={c.glow} maxTilt={4} className="flex h-full flex-col p-7 sm:p-9">
                <div className="relative mb-8 h-36 overflow-hidden rounded-2xl border border-line bg-ink/40">
                  {Art && <Art />}
                </div>
                <p className="eyebrow text-cyan/70">{c.kicker}</p>
                <h3 className="mt-4 font-display text-2xl font-semibold tracking-[-0.035em] text-paper">
                  {c.title}
                </h3>
                <div className="mt-5 text-[0.9375rem] leading-relaxed text-mute-2">
                  {c.paragraphs.map((p, i) => (
                    <p key={i} className={i > 0 ? 'mt-4' : undefined}>
                      {p}
                    </p>
                  ))}
                </div>
              </TiltCard>
            </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}

/* ---------------- Card art ---------------- */

function FragmentArt() {
  // Scattered shards that never quite meet: the problem, stated visually.
  const shards = [
    { x: 12, y: 22, w: 26, h: 8, r: -12 },
    { x: 54, y: 16, w: 30, h: 8, r: 9 },
    { x: 22, y: 48, w: 22, h: 8, r: 7 },
    { x: 58, y: 58, w: 26, h: 8, r: -8 },
    { x: 34, y: 74, w: 18, h: 8, r: 14 },
  ];
  return (
    <div aria-hidden className="absolute inset-0">
      <div className="lattice-fine absolute inset-0 opacity-40" />
      {shards.map((s, i) => (
        <motion.span
          key={i}
          className="absolute rounded-md border border-white/12 bg-white/[0.05]"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.w}%`,
            height: `${s.h}%`,
            rotate: `${s.r}deg`,
          }}
          animate={{ opacity: [0.35, 0.85, 0.35] }}
          transition={{ duration: 4.5, repeat: Infinity, delay: i * 0.5, ease: 'easeInOut' }}
        />
      ))}
      <span className="absolute inset-0 bg-[radial-gradient(70%_70%_at_50%_50%,transparent_40%,#050816_100%)]" />
    </div>
  );
}

function HorizonArt() {
  // A horizon line with a rising marker: where the category is going.
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(180deg,transparent,rgba(45,123,255,0.16))]" />
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="absolute inset-x-0 h-px bg-[linear-gradient(90deg,transparent,rgba(85,230,255,0.28),transparent)]"
          style={{ bottom: `${12 + i * 16}%`, opacity: 1 - i * 0.22 }}
        />
      ))}
      <motion.span
        className="absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cyan"
        style={{ boxShadow: '0 0 18px 4px rgba(85,230,255,0.6)' }}
        animate={{ bottom: ['14%', '68%', '14%'] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      />
      <span className="absolute top-1/2 left-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue/25 blur-3xl" />
    </div>
  );
}

function NetworkArt() {
  // Everything wired to one centre: the mission, stated visually.
  const spokes = [0, 60, 120, 180, 240, 300];
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center">
      <span className="absolute h-24 w-24 rounded-full bg-violet/25 blur-3xl" />
      {spokes.map((deg, i) => (
        <span
          key={deg}
          className="absolute h-px w-[38%] origin-left bg-[linear-gradient(90deg,rgba(111,92,255,0.55),transparent)]"
          style={{ transform: `rotate(${deg}deg)`, left: '50%' }}
        >
          <motion.span
            className="absolute -top-[2.5px] h-1.5 w-1.5 rounded-full bg-violet"
            animate={{ left: ['0%', '92%', '0%'], opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 4.5, repeat: Infinity, delay: i * 0.55, ease: 'easeInOut' }}
          />
        </span>
      ))}
      <span className="relative h-9 w-9 rounded-xl border border-violet/45 bg-ink-2 shadow-[0_0_28px_-6px_rgba(111,92,255,0.9)]" />
    </div>
  );
}
