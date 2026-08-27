import { ArrowUpRight } from 'lucide-react';
import { FINAL_CTA } from '@/lib/landing-content';
import { hubSignupUrl } from '@/lib/site';

export function EnterpriseCTA() {
  return (
    <section id="cta" className="section-pad relative scroll-mt-24 overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(90%_80%_at_50%_100%,#0d1c40_0%,#070E22_50%,#050816_85%)]" />
        <div className="aura bottom-[-25%] left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 bg-blue/16" />
      </div>
      <div className="shell relative text-center">
        <h2 className="mx-auto max-w-3xl font-display text-[clamp(2rem,5vw,3.75rem)] leading-[1.05] font-semibold tracking-[-0.04em] text-glow">
          {FINAL_CTA.title}
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-[1.0625rem] leading-relaxed text-mute">
          {FINAL_CTA.lede}
        </p>
        <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <a
            href={hubSignupUrl()}
            className="inline-flex h-[3.35rem] w-full items-center justify-center gap-2.5 rounded-full bg-[linear-gradient(100deg,#E879F9_0%,#6D5EF0_45%,#A855F7_100%)] px-8 text-base font-medium text-white sm:w-auto"
          >
            {FINAL_CTA.primary}
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
          <a
            href="#demo"
            className="inline-flex h-[3.35rem] w-full items-center justify-center rounded-full border border-line px-8 text-base font-medium text-paper transition-colors hover:border-cyan/40 hover:bg-white/[0.04] sm:w-auto"
          >
            {FINAL_CTA.secondary}
          </a>
        </div>
      </div>
    </section>
  );
}
