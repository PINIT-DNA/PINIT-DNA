'use client';

import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { useRef } from 'react';
import type { SectionChrome, SiteContent } from '@/lib/content';
import { icon as resolveIcon } from '@/lib/icons';
import { Reveal, RevealWords } from './ui/Reveal';
import { SectionHeading } from './ui/SectionHeading';

/** Scattered → converged positions, in percent of the stage. */
const CHIPS = [
  { label: 'IMG', from: { x: 6, y: 8, r: -14 }, tint: '#55E6FF' },
  { label: 'MP4', from: { x: 74, y: 4, r: 11 }, tint: '#2D7BFF' },
  { label: '</>', from: { x: 82, y: 62, r: -8 }, tint: '#14D991' },
  { label: 'PDF', from: { x: 2, y: 58, r: 9 }, tint: '#2D7BFF' },
  { label: 'FIG', from: { x: 40, y: 78, r: -12 }, tint: '#6F5CFF' },
  { label: 'WAV', from: { x: 66, y: 30, r: 7 }, tint: '#6F5CFF' },
  { label: 'DOC', from: { x: 14, y: 34, r: 13 }, tint: '#55E6FF' },
  { label: 'PPT', from: { x: 46, y: 12, r: -6 }, tint: '#2D7BFF' },
];

export function Problem({
  section,
  content,
}: {
  section: SectionChrome;
  content: SiteContent['problem'];
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.35'] });
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 26, restDelta: 0.001 });

  const hubScale = useTransform(progress, [0.35, 1], [0.6, 1]);
  const hubOpacity = useTransform(progress, [0.3, 0.8], [0, 1]);
  const scatterOpacity = useTransform(progress, [0, 0.35], [1, 0.25]);

  return (
    <section id="platform" ref={ref} className="section-pad relative scroll-mt-24">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#050816_0%,#070d1e_50%,#050816_100%)]" />
        <div className="aura top-[20%] left-[52%] h-[34rem] w-[34rem] bg-blue/12" />
      </div>

      <div className="shell">
        <SectionHeading
          index={section.index}
          label={section.label}
          title={section.title}
          lede={section.lede}
        />

        <div className="mt-16 grid gap-14 lg:mt-24 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
          {/* ---- Problem ledger ---- */}
          <ul className="relative">
            {content.items.map((p, i) => {
              const Icon = resolveIcon(p.icon);
              return (
              <Reveal key={p.id} delay={i * 0.06}>
                <li className="group relative flex gap-5 border-t border-line py-6 last:border-b">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 inset-y-0 rounded-2xl bg-[linear-gradient(90deg,rgba(45,123,255,0.09),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100 sm:inset-x-[-1.25rem]"
                  />
                  <span className="eyebrow relative mt-1.5 shrink-0 text-cyan/50">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-white/[0.03] transition-all duration-500 group-hover:-translate-y-0.5 group-hover:border-cyan/30 group-hover:bg-cyan/10">
                    <Icon className="h-[1.15rem] w-[1.15rem] text-mute transition-colors duration-500 group-hover:text-cyan" />
                  </span>
                  <span className="relative">
                    <h3 className="font-display text-[1.0625rem] font-medium text-paper">{p.title}</h3>
                    <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-mute-2">{p.body}</p>
                  </span>
                </li>
              </Reveal>
              );
            })}
          </ul>

          {/* ---- Convergence stage ---- */}
          <div className="relative">
            <div className="panel grain relative aspect-[4/5] overflow-hidden sm:aspect-[5/4] lg:sticky lg:top-28 lg:aspect-square">
              <div className="lattice-fine absolute inset-0 opacity-60" aria-hidden />
              <div
                aria-hidden
                className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_50%,rgba(45,123,255,0.16),transparent_70%)]"
              />

              {/* Disconnected silos the assets start out trapped in */}
              <motion.div style={{ opacity: scatterOpacity }} aria-hidden className="absolute inset-0">
                {[
                  { x: 4, y: 4, w: 40, h: 30 },
                  { x: 58, y: 8, w: 36, h: 26 },
                  { x: 8, y: 58, w: 34, h: 32 },
                  { x: 56, y: 62, w: 38, h: 28 },
                ].map((s, i) => (
                  <span
                    key={i}
                    className="absolute rounded-xl border border-dashed border-white/[0.09]"
                    style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h}%` }}
                  />
                ))}
              </motion.div>

              {/* The hub they collapse into */}
              <motion.div
                style={{ scale: hubScale, opacity: hubOpacity }}
                aria-hidden
                className="absolute top-1/2 left-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2"
              >
                <span className="absolute inset-0 rounded-[1.75rem] bg-[linear-gradient(140deg,#55E6FF,#2D7BFF_45%,#6F5CFF)] opacity-90 blur-[1px]" />
                <span className="absolute inset-[3px] rounded-[1.6rem] bg-ink-2" />
                <span className="anim-breathe absolute -inset-6 rounded-full bg-blue/30 blur-2xl" />
                <span className="absolute inset-0 grid place-items-center font-display text-sm font-bold tracking-[-0.03em]">
                  <span className="text-beam">PINITHUB</span>
                </span>
                <span className="anim-spin-slow absolute -inset-8 rounded-full border border-cyan/20" />
              </motion.div>

              {CHIPS.map((c, i) => (
                <ConvergingChip key={c.label + i} chip={c} progress={progress} index={i} />
              ))}
            </div>
          </div>
        </div>

        {/* ---- Resolution ---- */}
        <div className="relative mt-16 sm:mt-24 lg:mt-36">
          <div aria-hidden className="absolute inset-x-0 -top-12 mx-auto h-px w-2/3 bg-[linear-gradient(90deg,transparent,rgba(85,230,255,0.35),transparent)]" />
          <div className="text-center">
            <RevealWords
              text={content.resolutionTitle}
              className="mx-auto max-w-4xl font-display text-[clamp(2rem,4.8vw,3.75rem)] leading-[1.04] font-semibold text-glow"
            />
            <Reveal delay={0.18}>
              <p className="mx-auto mt-6 max-w-2xl text-[1.0625rem] leading-relaxed text-mute">
                {content.resolutionBody}
              </p>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

function ConvergingChip({
  chip,
  progress,
  index,
}: {
  chip: (typeof CHIPS)[number];
  progress: MotionValue<number>;
  index: number;
}) {
  const reduce = useReducedMotion();
  // Staggered arrival so the assets land in sequence rather than as one blob.
  const start = 0.12 + index * 0.045;
  const end = start + 0.42;

  const x = useTransform(progress, [start, end], [chip.from.x, 50 - 5.5]);
  const y = useTransform(progress, [start, end], [chip.from.y, 50 - 4]);
  const rot = useTransform(progress, [start, end], [chip.from.r, 0]);
  const scale = useTransform(progress, [start, end, 1], [1, 0.55, 0.4]);
  const opacity = useTransform(progress, [start, end, 1], [1, 0.5, 0]);

  // Hooks stay unconditional; only the value handed to `style` branches.
  const left = useTransform(x, (v) => `${v}%`);
  const top = useTransform(y, (v) => `${v}%`);

  const style = reduce
    ? { left: `${chip.from.x}%`, top: `${chip.from.y}%` }
    : { left, top, rotate: rot, scale, opacity };

  return (
    <motion.span
      aria-hidden
      style={style}
      className="absolute flex w-[11%] min-w-[3.75rem] items-center gap-1.5 rounded-lg border border-white/12 bg-ink-2/85 px-2 py-1.5 backdrop-blur-sm"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: chip.tint }} />
      <span className="font-mono text-[0.625rem] tracking-tight text-paper/90">{chip.label}</span>
    </motion.span>
  );
}
