import { SectionHeader } from '@/components/ui/SectionHeader';
import { EVIDENCE_FLOW } from '@/lib/landing-content';

export function AssetEvidenceFlow() {
  return (
    <section id="evidence" className="section-pad relative scroll-mt-24">
      <div className="shell">
        <SectionHeader
          index={EVIDENCE_FLOW.index}
          label={EVIDENCE_FLOW.label}
          title={EVIDENCE_FLOW.title}
          lede={EVIDENCE_FLOW.lede}
          align="center"
        />

        <ol className="relative mx-auto mt-12 max-w-4xl lg:mt-16">
          <div
            aria-hidden
            className="absolute top-4 bottom-4 left-[1.15rem] w-px bg-[linear-gradient(180deg,transparent,rgba(85,230,255,0.35),transparent)] sm:left-1/2 sm:-translate-x-px"
          />
          {EVIDENCE_FLOW.stages.map((stage, i) => (
            <li
              key={stage.label}
              className={`relative mb-8 flex gap-4 last:mb-0 sm:items-center ${
                i % 2 === 0 ? 'sm:flex-row' : 'sm:flex-row-reverse sm:text-right'
              }`}
            >
              <div className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-cyan/40 bg-ink font-mono text-[0.6875rem] text-cyan sm:absolute sm:left-1/2 sm:-translate-x-1/2">
                {String(i + 1).padStart(2, '0')}
              </div>
              <div
                className={`flex-1 rounded-xl border border-line bg-ink-2/70 p-4 sm:max-w-[42%] ${
                  i % 2 === 0 ? 'sm:mr-auto' : 'sm:ml-auto'
                }`}
              >
                <h3 className="font-display text-base font-medium text-paper">{stage.label}</h3>
                <p className="mt-1 text-[0.875rem] text-mute-2">{stage.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
