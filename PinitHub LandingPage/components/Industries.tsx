'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { SectionChrome, SiteContent } from '@/lib/content';
import { icon as resolveIcon } from '@/lib/icons';
import { RevealGroup, RevealItem } from './ui/Reveal';
import { SectionHeading } from './ui/SectionHeading';

export function Industries({
  section,
  industries,
}: {
  section: SectionChrome;
  industries: SiteContent['industries'];
}) {
  const [active, setActive] = useState<number | null>(null);
  const [hoverCapable, setHoverCapable] = useState(false);

  useEffect(() => {
    setHoverCapable(window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  }, []);

  const toggle = (i: number) => setActive((prev) => (prev === i ? null : i));

  return (
    <section className="relative overflow-hidden section-pad">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#050816,#06091a_50%,#050816)]" />
        <div className="lattice absolute inset-0 opacity-30" />
      </div>

      <div className="shell">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:gap-20">
          <div className="lg:sticky lg:top-28">
            <SectionHeading
              index={section.index}
              label={section.label}
              title={section.title}
              lede={section.lede}
            />
          </div>

          <RevealGroup className="grid grid-cols-2 gap-3 sm:grid-cols-3" stagger={0.04}>
            {industries.map((ind, i) => {
              const isActive = active === i;
              const Icon = resolveIcon(ind.icon);
              return (
                <RevealItem key={ind.id}>
                  <button
                    type="button"
                    onMouseEnter={() => hoverCapable && setActive(i)}
                    onMouseLeave={() => hoverCapable && setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => hoverCapable && setActive(null)}
                    onClick={() => toggle(i)}
                    aria-expanded={isActive}
                    aria-describedby={isActive ? `industry-${i}` : undefined}
                    className={`group relative flex h-36 w-full flex-col justify-between overflow-hidden rounded-2xl border p-4 text-left transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] sm:h-40 sm:p-5 ${
                      isActive
                        ? '-translate-y-1 border-cyan/35 bg-[linear-gradient(160deg,rgba(45,123,255,0.16),rgba(5,8,22,0.7))] shadow-[0_28px_60px_-30px_rgba(45,123,255,0.9)]'
                        : 'border-line bg-white/[0.02] hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="lattice-fine absolute inset-0 opacity-40" aria-hidden />

                    <span className="relative flex items-center justify-between">
                      <Icon
                        className={`h-5 w-5 transition-colors duration-500 ${
                          isActive ? 'text-cyan' : 'text-mute-2'
                        }`}
                        strokeWidth={1.6}
                      />
                      <span className="eyebrow text-[0.5625rem] opacity-45">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                    </span>

                    <span className="relative block">
                      <span className="block font-display text-[1.0625rem] font-medium tracking-[-0.03em] text-paper">
                        {ind.name}
                      </span>
                      {/* The use case unfolds beneath the label rather than replacing it */}
                      <AnimatePresence initial={false}>
                        {isActive && (
                          <motion.span
                            key="use"
                            id={`industry-${i}`}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
                            className="block overflow-hidden text-[0.75rem] leading-snug text-mute"
                          >
                            <span className="block pt-2">{ind.useCase}</span>
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                  </button>
                </RevealItem>
              );
            })}
          </RevealGroup>
        </div>
      </div>
    </section>
  );
}
