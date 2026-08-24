'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Star } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { SectionChrome, SiteContent } from '@/lib/content';
import { Reveal } from './ui/Reveal';
import { SectionHeading } from './ui/SectionHeading';

const INTERVAL = 7000;

export function Testimonials({
  section,
  quotes,
}: {
  section: SectionChrome;
  quotes: SiteContent['testimonials'];
}) {
  const [[index, dir], setState] = useState<[number, number]>([0, 1]);
  const [paused, setPaused] = useState(false);

  const count = quotes.length;

  const go = useCallback(
    (step: number) => {
      setState(([i]) => [(i + step + count) % count, step]);
    },
    [count],
  );

  useEffect(() => {
    if (paused || count < 2) return;
    const id = window.setInterval(() => go(1), INTERVAL);
    return () => window.clearInterval(id);
  }, [go, paused, count]);

  // Unpublishing quotes can leave `index` past the end of the list.
  const q = quotes[index] ?? quotes[0];
  if (!q) return null;

  return (
    <section
      className="relative overflow-hidden section-pad"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#050816,#070C1D_55%,#050816)]" />
        <div className="aura top-[24%] left-[36%] h-[30rem] w-[30rem] bg-blue/10" />
      </div>

      <div className="shell">
        <SectionHeading
          index={section.index}
          label={section.label}
          title={section.title}
          lede={section.lede}
          align="center"
        />

        <Reveal delay={0.1}>
          <div
            className="relative mt-16 lg:mt-20"
            role="region"
            aria-roledescription="carousel"
            aria-label="Customer testimonials"
          >
            <div className="panel grain relative overflow-hidden px-6 py-12 sm:px-14 sm:py-16 lg:px-20 lg:py-20">
              <div
                aria-hidden
                className="absolute inset-0 bg-[radial-gradient(80%_120%_at_15%_0%,rgba(45,123,255,0.13),transparent_62%)]"
              />
              <span aria-hidden className="pin-cross top-5 left-5" />
              <span aria-hidden className="pin-cross right-5 bottom-5" />

              {/* Oversized quote mark, used as a graphic rather than punctuation */}
              <span
                aria-hidden
                className="pointer-events-none absolute -top-8 right-6 font-display text-[12rem] leading-none font-bold text-white/[0.035] select-none sm:text-[16rem]"
              >
                &rdquo;
              </span>

              <div className="relative min-h-[22rem] sm:min-h-[18rem]">
                <AnimatePresence mode="wait" custom={dir}>
                  <motion.blockquote
                    key={index}
                    custom={dir}
                    initial={{ opacity: 0, x: dir * 48, filter: 'blur(10px)' }}
                    animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, x: dir * -48, filter: 'blur(10px)' }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className="grid gap-10 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-14"
                  >
                    {/* Portrait placeholder: monogram plate, deliberately not a stock photo */}
                    <div className="shrink-0">
                      <div className="relative h-24 w-24 sm:h-32 sm:w-32">
                        <span
                          aria-hidden
                          className="absolute -inset-2 rounded-3xl opacity-30 blur-xl"
                          style={{ background: q.tint }}
                        />
                        <span className="relative grid h-full w-full place-items-center overflow-hidden rounded-3xl border border-white/12 bg-[linear-gradient(150deg,rgba(23,39,68,0.95),rgba(6,11,26,0.9))]">
                          <span className="lattice-fine absolute inset-0 opacity-50" aria-hidden />
                          <span
                            className="relative font-display text-3xl font-semibold tracking-tight"
                            style={{ color: q.tint }}
                          >
                            {q.initials}
                          </span>
                        </span>
                      </div>
                      <div className="mt-5 flex gap-1" aria-label={`Rated ${q.rating} out of 5`}>
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-3.5 w-3.5 ${
                              i < q.rating ? 'fill-cyan text-cyan' : 'text-white/15'
                            }`}
                            aria-hidden
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="font-display text-[clamp(1.25rem,2.4vw,1.875rem)] leading-[1.35] font-medium tracking-[-0.03em] text-glow">
                        {q.quote}
                      </p>
                      <footer className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-6">
                        <cite className="font-display text-[1.0625rem] font-medium text-paper not-italic">
                          {q.name}
                        </cite>
                        <span aria-hidden className="h-3 w-px bg-line" />
                        <span className="text-[0.9375rem] text-mute-2">{q.role}</span>
                      </footer>
                    </div>
                  </motion.blockquote>
                </AnimatePresence>
              </div>

              {/* Controls */}
              <div className="relative mt-4 flex items-center justify-between gap-6">
                <div className="flex gap-2" role="tablist" aria-label="Choose testimonial">
                  {quotes.map((item, i) => (
                    <button
                      key={item.id}
                      role="tab"
                      aria-selected={i === index}
                      aria-label={`Testimonial from ${item.name}`}
                      onClick={() => setState([i, i > index ? 1 : -1])}
                      className="group py-2"
                    >
                      <span
                        className={`block h-[3px] rounded-full transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                          i === index
                            ? 'w-10 bg-[linear-gradient(90deg,#55E6FF,#2D7BFF)]'
                            : 'w-5 bg-white/15 group-hover:bg-white/30'
                        }`}
                      />
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <CarouselButton label="Previous testimonial" onClick={() => go(-1)}>
                    <ArrowLeft className="h-4 w-4" />
                  </CarouselButton>
                  <CarouselButton label="Next testimonial" onClick={() => go(1)}>
                    <ArrowRight className="h-4 w-4" />
                  </CarouselButton>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function CarouselButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-11 w-11 place-items-center rounded-full border border-line text-mute transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-cyan/40 hover:bg-white/[0.05] hover:text-paper"
    >
      {children}
    </button>
  );
}
