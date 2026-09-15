import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SECURITY } from '@/lib/landing-content';

export function SecuritySection() {
  return (
    <section id="security" className="section-pad relative scroll-mt-24">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-ink-2" />
        <div className="aura bottom-[-10%] right-[10%] h-[26rem] w-[26rem] bg-blue/8" />
      </div>
      <div className="shell">
        <SectionHeader
          index={SECURITY.index}
          label={SECURITY.label}
          title={SECURITY.title}
          lede={SECURITY.lede}
        />
        <ul className="mt-12 grid gap-3 sm:grid-cols-2 lg:mt-16 lg:grid-cols-3">
          {SECURITY.items.map((item) => (
            <li key={item.title}>
              <Card as="article" className="h-full p-6">
                <h3 className="font-display text-lg font-medium text-paper">{item.title}</h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-mute-2">{item.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
