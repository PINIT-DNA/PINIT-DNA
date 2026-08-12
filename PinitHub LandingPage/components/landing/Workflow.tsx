'use client';

import { useState } from 'react';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { WORKFLOW_STEPS } from '@/lib/landing-content';

export function Workflow() {
  const [active, setActive] = useState(0);
  const step = WORKFLOW_STEPS[active];

  return (
    <section id="workflow" className="section-pad relative scroll-mt-24">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-ink-2" />
        <div className="lattice absolute inset-0 opacity-30" />
      </div>
      <div className="shell">
        <SectionHeader
          index="02"
          label="How it works"
          title="Protect → Prove → Share → Detect → Investigate"
          lede="The PinIT Hub lifecycle available today. Each step is a customer outcome—mechanisms sit underneath."
        />

        <div className="mt-12 grid gap-8 lg:mt-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-12">
          <div
            role="tablist"
            aria-label="Lifecycle stages"
            className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible"
          >
            {WORKFLOW_STEPS.map((s, i) => {
              const selected = i === active;
              return (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  id={`workflow-tab-${i}`}
                  aria-controls="workflow-panel"
                  onClick={() => setActive(i)}
                  className={`shrink-0 rounded-xl border px-4 py-3 text-left transition-colors lg:w-full ${
                    selected
                      ? 'border-cyan/35 bg-cyan/10 text-paper'
                      : 'border-line bg-ink/40 text-mute hover:border-white/15 hover:text-paper'
                  }`}
                >
                  <span className="font-mono text-[0.625rem] text-mute-2">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="mt-1 block font-display text-base font-medium">{s.key}</span>
                </button>
              );
            })}
          </div>

          <div
            id="workflow-panel"
            role="tabpanel"
            aria-labelledby={`workflow-tab-${active}`}
            className="rounded-[var(--radius-xl)] border border-line bg-ink/50 p-6 sm:p-8"
          >
            <StatusPill status={step.status} />
            <h3 className="mt-5 font-display text-[clamp(1.5rem,3vw,2rem)] font-semibold tracking-[-0.03em] text-paper">
              {step.headline}
            </h3>
            <p className="mt-4 max-w-xl text-[1rem] leading-relaxed text-mute">{step.body}</p>
            <ol className="mt-8 flex flex-wrap gap-2" aria-hidden>
              {WORKFLOW_STEPS.map((s, i) => (
                <li
                  key={s.key}
                  className={`rounded-full border px-3 py-1 font-mono text-[0.625rem] tracking-wider uppercase ${
                    i === active ? 'border-cyan/40 text-cyan' : 'border-line text-mute-2'
                  }`}
                >
                  {s.key}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
