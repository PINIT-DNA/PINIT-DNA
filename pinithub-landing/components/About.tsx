'use client';

import { motion } from 'framer-motion';
import type { SectionChrome, SiteContent } from '@/lib/content';
import { Reveal } from './ui/Reveal';
import { SectionHeading } from './ui/SectionHeading';

export function About({
  section,
  content,
}: {
  section: SectionChrome;
  content: SiteContent['about'];
}) {
  const { pillars, team } = content;

  return (
    <section id="company" className="relative scroll-mt-24 overflow-hidden section-pad">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-ink-2" />
        <div className="aura top-[16%] left-[-10%] h-[32rem] w-[32rem] bg-blue/12" />
        <div className="aura right-[-8%] bottom-[6%] h-[26rem] w-[26rem] bg-violet/12" />
      </div>

      <div className="shell">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
          <div>
            <SectionHeading
              index={section.index}
              label={section.label}
              title={section.title}
              lede={section.lede}
            />

            <Reveal delay={0.16}>
              <p className="mt-8 max-w-xl text-[0.9375rem] leading-relaxed text-mute-2">
                {content.body1}
              </p>
              <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-mute-2">
                {content.body2}
              </p>
            </Reveal>

            <Reveal delay={0.22}>
              <dl className="mt-12 grid grid-cols-2 gap-x-8 gap-y-8 border-t border-line pt-10">
                {pillars.map((p) => (
                  <div key={p.id} className="group">
                    <dt className="flex items-center gap-2.5 font-display text-[0.9375rem] font-medium text-paper">
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_10px_2px_rgba(85,230,255,0.55)] transition-transform duration-500 group-hover:scale-125"
                      />
                      {p.title}
                    </dt>
                    <dd className="mt-2 text-[0.875rem] leading-relaxed text-mute-2">{p.body}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>

          <div className="lg:pt-8">
            <Reveal direction="left">
              <div className="panel grain relative aspect-[4/3] overflow-hidden">
                <HQVisual label={content.hqLabel} />
              </div>
            </Reveal>
          </div>
        </div>

        {team.length > 0 && (
          <div className="mt-24 border-t border-line pt-16 lg:mt-32">
            <Reveal>
              <p className="eyebrow">The team</p>
            </Reveal>
            <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {team.map((m, i) => (
                <Reveal key={m.id} delay={i * 0.06}>
                  <div className="group">
                    <div className="relative h-16 w-16">
                      <span
                        aria-hidden
                        className="absolute -inset-1.5 rounded-2xl opacity-25 blur-lg transition-opacity duration-500 group-hover:opacity-50"
                        style={{ background: m.tint }}
                      />
                      <span className="relative grid h-full w-full place-items-center overflow-hidden rounded-2xl border border-white/12 bg-[linear-gradient(150deg,rgba(23,39,68,0.95),rgba(6,11,26,0.9))]">
                        <span className="lattice-fine absolute inset-0 opacity-50" aria-hidden />
                        <span
                          className="relative font-display text-lg font-semibold tracking-tight"
                          style={{ color: m.tint }}
                        >
                          {m.initials}
                        </span>
                      </span>
                    </div>
                    <h3 className="mt-5 font-display text-[1.0625rem] font-medium text-paper">
                      {m.name}
                    </h3>
                    <p className="mt-1 font-mono text-[0.6875rem] tracking-[0.12em] text-cyan/70 uppercase">
                      {m.role}
                    </p>
                    {m.bio && (
                      <p className="mt-3 text-[0.875rem] leading-relaxed text-mute-2">{m.bio}</p>
                    )}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Abstract headquarters: a lit tower on a blueprint plane. */
function HQVisual({ label }: { label: string }) {
  const towers = [
    { x: 18, w: 12, h: 46, delay: 0 },
    { x: 32, w: 16, h: 72, delay: 0.12 },
    { x: 50, w: 13, h: 58, delay: 0.24 },
    { x: 65, w: 18, h: 84, delay: 0.36 },
    { x: 85, w: 10, h: 38, delay: 0.48 },
  ];

  return (
    <div aria-hidden className="absolute inset-0">
      <div className="lattice-fine absolute inset-0 opacity-45" />
      <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_100%,rgba(45,123,255,0.2),transparent_65%)]" />

      <div className="absolute inset-x-0 bottom-[18%] flex h-[62%] items-end justify-center gap-3">
        {towers.map((t) => (
          <motion.div
            key={t.x}
            initial={{ height: '0%', opacity: 0 }}
            whileInView={{ height: `${t.h}%`, opacity: 1 }}
            viewport={{ once: true, margin: '-15%' }}
            transition={{ duration: 1.1, delay: t.delay, ease: [0.16, 1, 0.3, 1] }}
            className="relative rounded-t-sm border-x border-t border-white/12 bg-[linear-gradient(180deg,rgba(23,39,68,0.9),rgba(6,11,26,0.5))]"
            style={{ width: `${t.w}%` }}
          >
            <span className="absolute inset-2 grid grid-cols-3 content-start gap-1">
              {Array.from({ length: 21 }).map((_, i) => (
                <motion.span
                  key={i}
                  className="h-1 rounded-[1px] bg-cyan/60"
                  animate={{ opacity: [0.15, 0.9, 0.15] }}
                  transition={{
                    duration: 4 + (i % 5),
                    repeat: Infinity,
                    delay: (i % 7) * 0.4,
                    ease: 'easeInOut',
                  }}
                />
              ))}
            </span>
          </motion.div>
        ))}
      </div>

      <div className="absolute inset-x-0 bottom-0 h-[18%] bg-[linear-gradient(180deg,rgba(85,230,255,0.14),transparent)]" />
      <div className="absolute inset-x-0 bottom-[18%] h-px bg-[linear-gradient(90deg,transparent,rgba(85,230,255,0.6),transparent)]" />

      <motion.span
        className="absolute top-[16%] h-1.5 w-1.5 rounded-full bg-paper"
        style={{ boxShadow: '0 0 12px 3px rgba(248,250,252,0.7)' }}
        animate={{ left: ['-5%', '105%'] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'linear', repeatDelay: 3 }}
      />
      <span className="absolute top-4 left-5 font-mono text-[0.625rem] tracking-[0.18em] text-mute-2">
        {label}
      </span>
    </div>
  );
}
