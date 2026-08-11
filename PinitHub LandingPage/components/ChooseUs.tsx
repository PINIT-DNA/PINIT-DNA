'use client';

import type { SectionChrome, SiteContent } from '@/lib/content';
import { icon as resolveIcon } from '@/lib/icons';
import { RevealGroup, RevealItem } from './ui/Reveal';
import { SectionHeading } from './ui/SectionHeading';

export function ChooseUs({
  section,
  reasons,
}: {
  section: SectionChrome;
  reasons: SiteContent['chooseUs'];
}) {
  return (
    <section className="relative overflow-hidden section-pad">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-ink-2" />
        <div className="aura top-[-8%] right-[24%] h-[30rem] w-[30rem] bg-cyan/10" />
      </div>

      <div className="shell">
        <SectionHeading
          index={section.index}
          label={section.label}
          title={section.title}
          lede={section.lede}
          align="center"
        />

        {/* Hairline matrix: cells share borders, so the grid reads as one instrument panel */}
        <RevealGroup
          className="mt-16 grid overflow-hidden rounded-3xl border border-line bg-ink/40 sm:grid-cols-2 lg:mt-20 lg:grid-cols-3"
          stagger={0.06}
        >
          {reasons.map((r, i) => {
            const Icon = resolveIcon(r.icon);
            return (
            <RevealItem
              key={r.id}
              className="group relative border-b border-line p-8 last:border-b-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 lg:border-r lg:[&:nth-child(3n)]:border-r-0 lg:[&:nth-child(odd)]:border-r lg:[&:nth-last-child(-n+3)]:border-b-0"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_0%,rgba(45,123,255,0.12),transparent_70%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              />
              <span aria-hidden className="pin-cross -top-[4px] -left-[4px] opacity-0 transition-opacity duration-500 group-hover:opacity-60" />

              <div className="relative">
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-white/[0.03] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1 group-hover:border-cyan/35 group-hover:bg-cyan/10 group-hover:shadow-[0_0_28px_-8px_rgba(85,230,255,0.9)]">
                    <Icon
                      className="h-[1.15rem] w-[1.15rem] text-mute transition-colors duration-500 group-hover:text-cyan"
                      strokeWidth={1.6}
                    />
                  </span>
                  <span className="eyebrow text-[0.625rem] opacity-50">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>

                <h3 className="mt-6 font-display text-lg font-medium tracking-[-0.03em] text-paper">
                  {r.title}
                </h3>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-mute-2">{r.body}</p>
                <p className="mt-6 font-mono text-[0.6875rem] tracking-[0.12em] text-cyan/70 uppercase">
                  {r.stat}
                </p>
              </div>
            </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
