'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SectionChrome, SiteContent } from '@/lib/content';
import { icon as resolveIcon } from '@/lib/icons';
import { Reveal } from './ui/Reveal';
import { SectionHeading } from './ui/SectionHeading';

const AUTOPLAY_MS = 5200;

export function Lifecycle({
  section,
  stages,
}: {
  section: SectionChrome;
  stages: SiteContent['lifecycle'];
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  const count = stages.length;

  useEffect(() => {
    if (paused || count < 2) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [paused, count]);

  const onKeyNav = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActive((i) => (i + 1) % count);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActive((i) => (i - 1 + count) % count);
      }
    },
    [count],
  );

  // Keep the selected stage in view on narrow screens.
  useEffect(() => {
    const rail = railRef.current;
    const node = rail?.querySelector<HTMLElement>(`[data-stage="${active}"]`);
    if (!rail || !node) return;
    const target = node.offsetLeft - rail.clientWidth / 2 + node.clientWidth / 2;
    rail.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [active]);

  // The admin can delete stages, which may leave `active` past the end.
  const stage = stages[active] ?? stages[0];
  if (!stage) return null;

  return (
    <section id="how-it-works" className="relative scroll-mt-24 overflow-hidden section-pad">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-ink-2" />
        <div className="lattice absolute inset-0 opacity-40" />
        <div className="aura top-[-10%] left-[18%] h-[30rem] w-[30rem] bg-violet/12" />
        <div className="aura right-[10%] bottom-[-10%] h-[28rem] w-[28rem] bg-cyan/10" />
      </div>

      <div className="shell">
        <SectionHeading
          index={section.index}
          label={section.label}
          title={section.title}
          lede={section.lede}
          align="center"
        />

        {/* ---- Rail ---- */}
        <Reveal delay={0.1}>
          <div
            ref={railRef}
            role="tablist"
            aria-label="Digital asset lifecycle stages"
            onKeyDown={onKeyNav}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
            className="mt-16 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-4 lg:mt-20 lg:justify-center lg:overflow-visible [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: 'none' }}
          >
            {stages.map((s, i) => {
              const isActive = i === active;
              const Icon = resolveIcon(s.icon);
              return (
                <button
                  key={s.id}
                  data-stage={i}
                  role="tab"
                  id={`stage-tab-${i}`}
                  aria-selected={isActive}
                  aria-controls="stage-panel"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActive(i)}
                  className="group relative flex shrink-0 snap-center flex-col items-center gap-3 px-3 pt-2 pb-1 outline-none sm:px-5"
                >
                  <span
                    className={`relative grid h-14 w-14 place-items-center rounded-2xl border transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                      isActive
                        ? 'border-cyan/45 bg-[linear-gradient(150deg,rgba(85,230,255,0.22),rgba(45,123,255,0.1))] shadow-[0_0_38px_-8px_rgba(45,123,255,0.75)]'
                        : 'border-line bg-white/[0.025] group-hover:-translate-y-1 group-hover:border-white/20 group-hover:bg-white/[0.05]'
                    }`}
                  >
                    <Icon
                      className={`h-5 w-5 transition-all duration-500 ${
                        isActive
                          ? 'scale-110 text-cyan'
                          : 'text-mute-2 group-hover:scale-105 group-hover:text-paper'
                      }`}
                    />
                    {isActive && (
                      <motion.span
                        layoutId="stage-halo"
                        className="absolute -inset-2 -z-10 rounded-[1.35rem] bg-blue/25 blur-lg"
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                      />
                    )}
                  </span>
                  <span
                    className={`font-display text-[0.8125rem] font-medium tracking-tight whitespace-nowrap transition-colors duration-500 ${
                      isActive ? 'text-paper' : 'text-mute-2 group-hover:text-mute'
                    }`}
                  >
                    {s.key}
                  </span>
                </button>
              );
            })}
          </div>
        </Reveal>

        {/* ---- Connection line + progress ---- */}
        <Reveal delay={0.16}>
          <div aria-hidden className="relative mx-auto mt-1 hidden h-px max-w-4xl lg:block">
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(184,194,208,0.18)_15%,rgba(184,194,208,0.18)_85%,transparent)]" />
            <motion.div
              className="absolute inset-y-0 left-0 bg-[linear-gradient(90deg,#55E6FF,#2D7BFF)]"
              animate={{ width: `${((active + 1) / count) * 100}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            />
            <motion.span
              className="absolute -top-[3px] h-[7px] w-[7px] -translate-x-1/2 rounded-full bg-cyan shadow-[0_0_14px_3px_rgba(85,230,255,0.6)]"
              animate={{ left: `${((active + 1) / count) * 100}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </Reveal>

        {/* ---- Detail panel ---- */}
        <div
          id="stage-panel"
          role="tabpanel"
          aria-labelledby={`stage-tab-${active}`}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          className="panel grain relative mx-auto mt-10 max-w-5xl overflow-hidden px-5 py-8 sm:mt-12 sm:px-7 sm:py-10 md:px-12 md:py-14"
        >
          <span aria-hidden className="pin-cross top-4 left-4" />
          <span aria-hidden className="pin-cross top-4 right-4" />
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(90%_120%_at_10%_0%,rgba(45,123,255,0.14),transparent_60%)]"
          />

          <AnimatePresence mode="wait">
            <motion.div
              key={stage.key}
              initial={{ opacity: 0, y: 22, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -14, filter: 'blur(10px)' }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              className="relative grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-12"
            >
              <div>
                <p className="eyebrow text-cyan/70">
                  Stage {String(active + 1).padStart(2, '0')} — {stage.key}
                </p>
                <h3 className="mt-5 max-w-xl font-display text-[clamp(1.5rem,2.9vw,2.25rem)] leading-[1.14] font-semibold text-glow">
                  {stage.headline}
                </h3>
                <p className="mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-mute">{stage.body}</p>
              </div>

              <div
                className={`shrink-0 rounded-2xl border px-5 py-4 text-left sm:min-w-[11rem] sm:px-6 sm:py-5 sm:text-right ${
                  stage.metric.toLowerCase().includes('coming')
                    ? 'border-line bg-white/[0.03]'
                    : 'border-cyan/25 bg-cyan/5'
                }`}
              >
                <p
                  className={`font-display text-lg font-semibold sm:text-xl ${
                    stage.metric.toLowerCase().includes('coming') ? 'text-mute' : 'text-beam'
                  }`}
                >
                  {stage.metric}
                </p>
                <p className="eyebrow mt-2">{stage.metricLabel}</p>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Autoplay progress bar */}
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-white/5">
            <motion.div
              key={`${active}-${paused}`}
              className="h-full bg-[linear-gradient(90deg,#55E6FF,#6F5CFF)]"
              initial={{ width: '0%' }}
              animate={{ width: paused ? '0%' : '100%' }}
              transition={{ duration: paused ? 0.3 : AUTOPLAY_MS / 1000, ease: 'linear' }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
