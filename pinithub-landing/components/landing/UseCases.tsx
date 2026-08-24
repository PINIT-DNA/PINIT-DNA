import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { USE_CASES } from '@/lib/landing-content';

export function UseCases() {
  return (
    <section id="use-cases" className="section-pad relative scroll-mt-24">
      <div className="shell">
        <SectionHeader
          index={USE_CASES.index}
          label={USE_CASES.label}
          title={USE_CASES.title}
          lede={USE_CASES.lede}
          align="center"
        />
        <ul className="mt-12 grid gap-3 sm:grid-cols-2 lg:mt-16 lg:grid-cols-3">
          {USE_CASES.items.map((item) => (
            <li key={item.name}>
              <Card as="article" className="h-full p-5">
                <h3 className="font-display text-base font-medium text-paper">{item.name}</h3>
                <p className="mt-2 text-[0.875rem] leading-relaxed text-mute-2">{item.useCase}</p>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
