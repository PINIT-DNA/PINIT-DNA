import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { PRODUCT_STATUS } from '@/lib/landing-content';

export function ProductStatus() {
  return (
    <section id="status" className="section-pad relative scroll-mt-24">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-ink" />
        <div className="lattice absolute inset-0 opacity-25" />
      </div>
      <div className="shell">
        <SectionHeader
          index={PRODUCT_STATUS.index}
          label={PRODUCT_STATUS.label}
          title={PRODUCT_STATUS.title}
          lede={PRODUCT_STATUS.lede}
        />

        <div className="mt-12 grid gap-4 lg:mt-16 lg:grid-cols-2">
          <Card className="p-6 sm:p-8">
            <StatusPill status="available" />
            <h3 className="mt-4 font-display text-xl font-medium text-paper">Live in PinIT Hub</h3>
            <ul className="mt-5 space-y-2.5">
              {PRODUCT_STATUS.available.map((item) => (
                <li key={item} className="flex gap-2.5 text-[0.9375rem] text-mute">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-6 sm:p-8">
            <StatusPill status="roadmap" />
            <h3 className="mt-4 font-display text-xl font-medium text-paper">Roadmap</h3>
            <ul className="mt-5 space-y-2.5">
              {PRODUCT_STATUS.roadmap.map((item) => (
                <li key={item} className="flex gap-2.5 text-[0.9375rem] text-mute">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-mute-2" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="mt-6 grid gap-4 rounded-[var(--radius-xl)] border border-line bg-ink-2/50 p-6 sm:grid-cols-2 sm:p-8">
          <div>
            <p className="eyebrow">When Exchange ships</p>
            <h3 className="mt-3 font-display text-lg font-medium text-paper">Buyer</h3>
            <ul className="mt-3 space-y-2 text-[0.875rem] text-mute-2">
              {PRODUCT_STATUS.roles.buyer.map((r) => (
                <li key={r}>· {r}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow">When Exchange ships</p>
            <h3 className="mt-3 font-display text-lg font-medium text-paper">Seller</h3>
            <ul className="mt-3 space-y-2 text-[0.875rem] text-mute-2">
              {PRODUCT_STATUS.roles.seller.map((r) => (
                <li key={r}>· {r}</li>
              ))}
            </ul>
          </div>
          <p className="sm:col-span-2 text-[0.875rem] text-mute-2">{PRODUCT_STATUS.roles.note}</p>
        </div>
      </div>
    </section>
  );
}
