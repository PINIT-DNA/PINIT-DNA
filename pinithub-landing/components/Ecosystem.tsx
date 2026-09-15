'use client';

import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import type { SectionChrome, SiteContent } from '@/lib/content';
import { RevealGroup, RevealItem } from './ui/Reveal';
import { SectionHeading } from './ui/SectionHeading';
import { TiltCard } from './ui/TiltCard';

/**
 * Each product card carries a bespoke illustration. The database stores which
 * one by key, so the admin can reorder or re-word a product without the art
 * becoming detached from it. An unknown key simply renders no art.
 */
const ART: Record<string, () => React.JSX.Element> = {
  career: CareerArt,
  exchange: ExchangeArt,
  vault: VaultArt,
};

export function Ecosystem({
  section,
  products,
}: {
  section: SectionChrome;
  products: SiteContent['ecosystem'];
}) {
  return (
    <section id="resources" className="relative scroll-mt-24 overflow-hidden section-pad">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-ink-2" />
        <div className="lattice absolute inset-0 opacity-35" />
        <div className="aura top-[30%] left-[-8%] h-[30rem] w-[30rem] bg-violet/8" />
        <div className="aura right-[-6%] bottom-[8%] h-[28rem] w-[28rem] bg-cyan/6" />
      </div>

      <div className="shell">
        <SectionHeading
          index={section.index}
          label={section.label}
          title={section.title}
          lede={section.lede}
          align="center"
        />

        <RevealGroup className="mt-16 grid gap-5 lg:mt-20 lg:grid-cols-3" stagger={0.1}>
          {products.map((p) => {
            const Art = ART[p.artKey];
            return (
            <RevealItem key={p.id}>
              <TiltCard glow={p.glow} maxTilt={4} className="flex h-full flex-col p-7 sm:p-8">
                <div className="relative mb-8 h-44 overflow-hidden rounded-2xl border border-line bg-[radial-gradient(120%_100%_at_50%_0%,rgba(255,255,255,0.04),transparent_65%)]">
                  <div className="lattice-fine absolute inset-0 opacity-40" aria-hidden />
                  {Art && <Art />}
                </div>

                <h3 className="font-display text-2xl font-semibold tracking-[-0.035em] text-paper">
                  {p.name}
                </h3>
                <p className="mt-2 font-mono text-[0.75rem] tracking-[0.08em]" style={{ color: p.tint }}>
                  {p.tagline}
                </p>
                {(p.tagline.toLowerCase().includes('available') ||
                  p.tagline.toLowerCase().includes('coming') ||
                  p.tagline.toLowerCase().includes('roadmap')) && (
                  <span
                    className={`mt-3 inline-flex w-fit rounded-full border px-2.5 py-1 text-[0.625rem] font-semibold tracking-[0.14em] uppercase ${
                      p.tagline.toLowerCase().includes('available')
                        ? 'border-signal/35 bg-signal/8 text-signal'
                        : 'border-line bg-white/[0.03] text-mute-2'
                    }`}
                  >
                    {p.tagline.toLowerCase().includes('available') ? 'Available now' : 'Coming soon'}
                  </span>
                )}
                <p className="mt-5 text-[0.9375rem] leading-relaxed text-mute-2">{p.body}</p>

                <ul className="mt-6 space-y-2.5">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-center gap-2.5 text-[0.875rem] text-mute">
                      <span
                        aria-hidden
                        className="h-1 w-1 shrink-0 rounded-full"
                        style={{ background: p.tint }}
                      />
                      {pt}
                    </li>
                  ))}
                </ul>

                <a
                  href={p.ctaHref}
                  {...(p.ctaHref.startsWith('http')
                    ? { target: '_blank', rel: 'noopener noreferrer' }
                    : {})}
                  className="group/link mt-8 inline-flex items-center gap-2 self-start border-b border-transparent pb-1 text-[0.9375rem] font-medium text-paper transition-colors duration-300 hover:border-current"
                  style={{ color: p.tint }}
                >
                  {p.ctaLabel}
                  <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
                  <span className="sr-only">about {p.name}</span>
                </a>
              </TiltCard>
            </RevealItem>
            );
          })}
        </RevealGroup>

        <div className="mt-14 grid gap-4 rounded-2xl border border-line bg-ink/40 p-6 sm:mt-16 sm:grid-cols-2 sm:p-8">
          <div>
            <p className="eyebrow">When Exchange ships</p>
            <h3 className="mt-3 font-display text-xl font-medium tracking-[-0.03em] text-paper">
              Buyer
            </h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-mute-2">
              Browse, discover, and buy or license. Keep private assets in your own Hub. Cannot list or sell.
            </p>
          </div>
          <div>
            <p className="eyebrow">When Exchange ships</p>
            <h3 className="mt-3 font-display text-xl font-medium tracking-[-0.03em] text-paper">
              Seller
            </h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-mute-2">
              Protect, list, and sell or license. Keep a private Hub workspace. Cannot buy on the marketplace.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ==================================================================
   Bespoke card art. Built from primitives so it stays crisp,
   weightless, and consistent with the rest of the page.
   ================================================================== */

const float = (delay = 0, distance = 6) => ({
  animate: { y: [0, -distance, 0] },
  transition: { duration: 6, repeat: Infinity, ease: 'easeInOut' as const, delay },
});

function CareerArt() {
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center [perspective:900px]">
      <span className="absolute h-32 w-32 rounded-full bg-cyan/20 blur-3xl" />
      {/* Credential stack, rising */}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          {...float(i * 0.4, 5 + i * 2)}
          className="absolute rounded-xl border border-white/12 bg-[linear-gradient(150deg,rgba(23,39,68,0.95),rgba(6,11,26,0.92))] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)]"
          style={{
            width: `${58 - i * 8}%`,
            height: `${44 - i * 6}%`,
            transform: `translateY(${(i - 1) * 22}px) rotateX(52deg) rotateZ(${(i - 1) * -6}deg)`,
          }}
        />
      ))}
      {/* Verified badge */}
      <motion.span
        {...float(0.9, 8)}
        className="absolute top-5 right-7 grid h-11 w-11 place-items-center rounded-full border border-cyan/40 bg-ink-2/90 backdrop-blur"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#55E6FF" strokeWidth="2">
          <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.span>
      <span className="absolute bottom-4 left-5 font-mono text-[0.625rem] tracking-[0.18em] text-mute-2">
        PORTFOLIO / VERIFIED
      </span>
    </div>
  );
}

function ExchangeArt() {
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center">
      <span className="absolute h-32 w-32 rounded-full bg-violet/25 blur-3xl" />
      {/* Order book columns trading against each other */}
      <div className="absolute inset-x-8 top-7 flex h-20 items-end gap-1.5">
        {[38, 62, 45, 78, 55, 90, 48, 70, 58, 84].map((h, i) => (
          <motion.span
            key={i}
            className="flex-1 rounded-sm"
            style={{
              background:
                i % 3 === 0
                  ? 'linear-gradient(180deg,#14D991,rgba(20,217,145,0.15))'
                  : 'linear-gradient(180deg,#6F5CFF,rgba(111,92,255,0.15))',
            }}
            animate={{ height: [`${h * 0.55}%`, `${h}%`, `${h * 0.7}%`] }}
            transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut', delay: i * 0.14 }}
          />
        ))}
      </div>
      {/* Settled trade ticket */}
      <motion.span
        {...float(0.5, 7)}
        className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-white/12 bg-ink/90 px-4 py-2.5 backdrop-blur"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-signal shadow-[0_0_8px_1px_#14D991]" />
        <span className="font-mono text-[0.6875rem] text-paper/90">LICENSE · SETTLED</span>
        <span className="font-mono text-[0.6875rem] text-signal">+ROYALTY</span>
      </motion.span>
    </div>
  );
}

function VaultArt() {
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center">
      <span className="absolute h-32 w-32 rounded-full bg-blue/25 blur-3xl" />
      {/* Concentric security rings */}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute rounded-full border"
          style={{
            width: `${44 + i * 22}%`,
            aspectRatio: '1',
            borderColor: `rgba(45,123,255,${0.35 - i * 0.09})`,
          }}
          animate={{ rotate: i % 2 === 0 ? 360 : -360 }}
          transition={{ duration: 30 + i * 12, repeat: Infinity, ease: 'linear' }}
        >
          <span
            className="absolute top-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan"
            style={{ boxShadow: '0 0 10px 2px rgba(85,230,255,0.7)' }}
          />
        </motion.span>
      ))}
      {/* Sealed core */}
      <motion.span
        {...float(0.2, 5)}
        className="relative grid h-16 w-16 place-items-center rounded-2xl border border-white/15 bg-[linear-gradient(150deg,rgba(23,39,68,0.98),rgba(6,11,26,0.96))] shadow-[0_20px_45px_-15px_rgba(0,0,0,0.95)]"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#2D7BFF" strokeWidth="1.7">
          <rect x="4" y="10" width="16" height="11" rx="2.5" />
          <path d="M8 10V7a4 4 0 1 1 8 0v3" strokeLinecap="round" />
        </svg>
      </motion.span>
      <span className="absolute bottom-4 left-5 font-mono text-[0.625rem] tracking-[0.18em] text-mute-2">
        AES-256 / ZERO TRUST
      </span>
    </div>
  );
}
