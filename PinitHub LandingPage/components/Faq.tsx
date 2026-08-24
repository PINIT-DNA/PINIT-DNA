'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { SectionChrome, SiteContent } from '@/lib/content';
import { Reveal } from './ui/Reveal';
import { SectionHeading } from './ui/SectionHeading';

/**
 * The objections, answered before the call. One panel open at a time — the list
 * is meant to be scanned, and keeping a single answer visible stops the page
 * from reflowing under the reader.
 */
export function Faq({ section, items }: { section: SectionChrome; items: SiteContent['faqs'] }) {
  const [open, setOpen] = useState<string | null>(items[0]?.id ?? null);

  if (!items.length) return null;

  return (
    <section id="faq" className="relative overflow-hidden section-pad">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-ink-2" />
        <div className="lattice absolute inset-0 opacity-30" />
        <div className="aura top-[14%] right-[-8%] h-[30rem] w-[30rem] bg-violet/12" />
      </div>

      <div className="shell">
        <SectionHeading
          index={section.index}
          label={section.label}
          title={section.title}
          lede={section.lede}
          align="center"
        />

        <div className="mx-auto mt-16 max-w-3xl lg:mt-20">
          <ul className="border-t border-line">
            {items.map((item, i) => {
              const isOpen = open === item.id;
              return (
                <Reveal key={item.id} delay={i * 0.05}>
                  <li className="group border-b border-line">
                    <h3>
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : item.id)}
                        aria-expanded={isOpen}
                        aria-controls={`faq-answer-${item.id}`}
                        className="flex w-full items-start gap-5 py-7 text-left outline-none"
                      >
                        <span className="eyebrow mt-1.5 shrink-0 text-cyan/50">
                          {String(i + 1).padStart(2, '0')}
                        </span>

                        <span
                          className={`flex-1 font-display text-[1.0625rem] leading-snug font-medium transition-colors duration-500 sm:text-[1.1875rem] ${
                            isOpen ? 'text-paper' : 'text-mute group-hover:text-paper'
                          }`}
                        >
                          {item.question}
                        </span>

                        <span
                          aria-hidden
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                            isOpen
                              ? 'rotate-45 border-cyan/45 bg-cyan/10 text-cyan'
                              : 'border-line text-mute-2 group-hover:border-white/20 group-hover:text-paper'
                          }`}
                        >
                          <Plus className="h-4 w-4" strokeWidth={1.8} />
                        </span>
                      </button>
                    </h3>

                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          key="answer"
                          id={`faq-answer-${item.id}`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden"
                        >
                          <p className="max-w-2xl pt-1 pb-6 pl-0 text-[0.875rem] leading-relaxed text-mute-2 sm:pl-[3.25rem] sm:text-[0.9375rem]">
                            {item.answer}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                </Reveal>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
