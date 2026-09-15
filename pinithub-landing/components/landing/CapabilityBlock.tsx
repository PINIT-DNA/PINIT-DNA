import type { ReactNode } from 'react';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { ProductMockup } from '@/components/ui/ProductMockup';
import type { StatusKind } from '@/lib/landing-content';

export function CapabilityBlock({
  id,
  index,
  label,
  title,
  lede,
  points,
  status,
  mockupTitle,
  mockup,
  reverse = false,
  anchorId,
}: {
  id?: string;
  index: string;
  label: string;
  title: string;
  lede: string;
  points: string[];
  status: StatusKind;
  mockupTitle: string;
  mockup: ReactNode;
  reverse?: boolean;
  /** First capability anchors the capabilities nav target */
  anchorId?: string;
}) {
  return (
    <section id={anchorId || id} className="section-pad relative scroll-mt-24">
      <div className="shell grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div className={reverse ? 'lg:order-2' : undefined}>
          <SectionHeader index={index} label={label} title={title} lede={lede} />
          <div className="mt-5">
            <StatusPill status={status} />
          </div>
          <ul className="mt-6 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex gap-3 text-[0.9375rem] leading-relaxed text-mute">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" aria-hidden />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={reverse ? 'lg:order-1' : undefined}>
          <ProductMockup title={mockupTitle}>{mockup}</ProductMockup>
        </div>
      </div>
    </section>
  );
}
