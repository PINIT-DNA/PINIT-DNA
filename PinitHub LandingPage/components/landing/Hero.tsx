import { ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { ProductMockup } from '@/components/ui/ProductMockup';
import { LANDING_HERO } from '@/lib/landing-content';
import { hubSignupUrl } from '@/lib/site';
import { HubDashboardMock } from './mockups';

export function LandingHero() {
  const [line1, line2] = LANDING_HERO.headline.split('\n');

  return (
    <section id="hero" className="relative isolate overflow-hidden pt-14 sm:pt-[4.5rem]">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(110%_80%_at_70%_10%,#0d1c3d_0%,#070E22_45%,#050816_80%)]" />
        <div className="lattice mask-radial absolute inset-0 opacity-50" />
        <div className="aura top-[-10%] right-[8%] h-[36rem] w-[36rem] bg-blue/14" />
        <div className="aura bottom-[-20%] left-[-10%] h-[30rem] w-[30rem] bg-violet/10" />
      </div>

      <div className="shell relative grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12 lg:py-20">
        <div className="max-w-2xl">
          <Badge tone="cyan">{LANDING_HERO.eyebrow}</Badge>

          <h1 className="mt-6 font-display text-[clamp(2.25rem,7vw,4.75rem)] leading-[0.98] font-semibold tracking-[-0.04em]">
            <span className="block text-glow">{line1}</span>
            <span className="mt-1 block text-beam">{line2}</span>
          </h1>

          <p className="mt-6 max-w-xl text-[1.0625rem] leading-[1.7] text-mute">{LANDING_HERO.lede}</p>

          <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <a
              href={hubSignupUrl()}
              className="inline-flex h-[3.35rem] w-full items-center justify-center gap-2.5 rounded-full bg-[linear-gradient(100deg,#55E6FF_0%,#2D7BFF_45%,#6F5CFF_100%)] px-8 text-base font-medium text-white sm:w-auto"
            >
              {LANDING_HERO.primaryCta}
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </a>
            <a
              href="#platform"
              className="inline-flex h-[3.35rem] w-full items-center justify-center gap-2 rounded-full border border-line px-8 text-base font-medium text-paper transition-colors hover:border-cyan/40 hover:bg-white/[0.04] sm:w-auto"
            >
              {LANDING_HERO.secondaryCta}
            </a>
            <a
              href="#demo"
              className="inline-flex h-[3.35rem] w-full items-center justify-center px-4 text-base font-medium text-mute transition-colors hover:text-paper sm:w-auto"
            >
              {LANDING_HERO.tertiaryCta}
            </a>
          </div>

          <p className="eyebrow mt-8 tracking-[0.16em] text-mute-2">
            {LANDING_HERO.loop.join(' · ')}
          </p>
          <p className="mt-4 max-w-lg text-[0.9375rem] text-mute-2">{LANDING_HERO.differentiator}</p>
        </div>

        <ProductMockup title="Workspace overview" className="w-full">
          <HubDashboardMock />
        </ProductMockup>
      </div>
    </section>
  );
}
