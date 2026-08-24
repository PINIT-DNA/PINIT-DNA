'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import type { SectionChrome, SiteContent } from '@/lib/content';
import { icon as resolveIcon } from '@/lib/icons';
import { RevealGroup, RevealItem } from './ui/Reveal';
import { SectionHeading } from './ui/SectionHeading';
import { TiltCard } from './ui/TiltCard';

const LOOP = ['Protect', 'Prove', 'Share', 'Detect', 'Investigate'];

export function Features({
  section,
  content,
}: {
  section: SectionChrome;
  content: SiteContent['features'];
}) {
  const { grid, featured } = content;

  return (
    <section className="relative overflow-hidden section-pad">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#050816,#060B1B_60%,#050816)]" />
        <div className="aura top-[8%] right-[-6%] h-[32rem] w-[32rem] bg-blue/12" />
      </div>

      <div className="shell">
        <SectionHeading
          index={section.index}
          label={section.label}
          title={section.title}
          lede={section.lede}
        />

        <RevealGroup className="mt-16 grid gap-4 sm:grid-cols-2 lg:mt-20 lg:grid-cols-6" stagger={0.06}>
          {grid.map((f, i) => (
            <RevealItem key={f.id} className={f.span}>
              <TiltCard glow={f.glow} className="h-full p-7 sm:p-8">
                <div className="flex h-full flex-col">
                  <div className="flex items-start justify-between gap-4">
                    <IconPlate icon={resolveIcon(f.icon)} tint={f.tint} />
                    <span className="eyebrow pt-1.5 text-[0.625rem] opacity-60">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>

                  <h3 className="mt-7 font-display text-xl font-medium tracking-[-0.03em] text-paper">
                    {f.title}
                  </h3>
                  <p className="mt-3 text-[0.9375rem] leading-relaxed text-mute-2">{f.body}</p>

                  <span
                    aria-hidden
                    className="mt-6 block h-px w-full origin-left scale-x-0 bg-[linear-gradient(90deg,var(--tint),transparent)] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-x-100"
                    style={{ ['--tint' as string]: f.tint }}
                  />
                </div>
              </TiltCard>
            </RevealItem>
          ))}

          {featured && (
            <RevealItem className={featured.span || 'sm:col-span-2 lg:col-span-6'}>
              <TiltCard glow={featured.glow} maxTilt={3} className="h-full p-7 sm:p-10">
                <div className="grid gap-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-12">
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <IconPlate icon={resolveIcon(featured.icon)} tint={featured.tint} />
                      <span className="eyebrow pt-1.5 text-[0.625rem] opacity-60">
                        {String(grid.length + 1).padStart(2, '0')}
                      </span>
                    </div>
                    <h3 className="mt-7 font-display text-xl font-medium tracking-[-0.03em] text-paper">
                      {featured.title}
                    </h3>
                    <p className="mt-3 max-w-md text-[0.9375rem] leading-relaxed text-mute-2">
                      {featured.body}
                    </p>
                  </div>

                  <div className="relative rounded-2xl border border-line bg-ink/50 p-6">
                    <p className="eyebrow">PinIT Hub core loop</p>
                    <p className="mt-2 font-mono text-xs text-cyan">Available now</p>
                    <ol className="mt-5 space-y-2.5">
                      {LOOP.map((step, i) => (
                        <motion.li
                          key={step}
                          initial={{ opacity: 0, x: 8 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{ delay: i * 0.06, duration: 0.4 }}
                          className="flex items-center gap-3 text-[0.875rem] text-mute"
                        >
                          <span className="grid h-6 w-6 place-items-center rounded-md border border-line font-mono text-[0.625rem] text-cyan">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          {step}
                        </motion.li>
                      ))}
                    </ol>
                  </div>
                </div>
              </TiltCard>
            </RevealItem>
          )}
        </RevealGroup>
      </div>
    </section>
  );
}

function IconPlate({ icon: Icon, tint }: { icon: LucideIcon; tint: string }) {
  return (
    <span className="relative inline-grid h-12 w-12 shrink-0 place-items-center">
      <span
        aria-hidden
        className="absolute inset-0 rounded-2xl opacity-45 blur-md transition-opacity duration-500 group-hover:opacity-90"
        style={{ background: tint }}
      />
      <span
        className="relative grid h-12 w-12 place-items-center rounded-2xl border border-white/12 bg-[linear-gradient(150deg,rgba(248,250,252,0.13),rgba(248,250,252,0.02))] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-0.5 group-hover:[transform:rotateX(12deg)_rotateY(-12deg)_translateY(-2px)]"
        style={{ transformStyle: 'preserve-3d' }}
      >
        <Icon className="h-[1.35rem] w-[1.35rem]" style={{ color: tint }} strokeWidth={1.6} />
      </span>
    </span>
  );
}
