import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { PLATFORM_LOOP } from '@/lib/landing-content';

export function PlatformLoop() {
  return (
    <section id="platform" className="section-pad relative scroll-mt-24">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-ink" />
        <div className="aura top-[20%] left-[40%] h-[28rem] w-[28rem] bg-blue/8" />
      </div>
      <div className="shell">
        <SectionHeader
          index={PLATFORM_LOOP.index}
          label={PLATFORM_LOOP.label}
          title={PLATFORM_LOOP.title}
          lede={PLATFORM_LOOP.lede}
        />
        <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:mt-16 lg:grid-cols-5">
          {PLATFORM_LOOP.pillars.map((p, i) => (
            <li key={p.title}>
              <Card className="h-full p-5">
                <p className="font-mono text-[0.625rem] text-mute-2">{String(i + 1).padStart(2, '0')}</p>
                <h3 className="mt-3 font-display text-lg font-medium" style={{ color: p.tint }}>
                  {p.title}
                </h3>
                <p className="mt-2 text-[0.875rem] leading-relaxed text-mute-2">{p.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
