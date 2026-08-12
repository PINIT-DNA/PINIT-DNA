'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, MessageSquare } from 'lucide-react';
import type { SiteContent } from '@/lib/content';
import { hubSignupUrl } from '@/lib/site';
import { MagneticButton } from './ui/MagneticButton';
import { ParticleField } from './ui/ParticleField';
import { Reveal, RevealWords } from './ui/Reveal';

export function FinalCTA({ content }: { content: SiteContent['cta'] }) {
  const reduce = useReducedMotion();

  return (
    <section id="pricing" className="relative scroll-mt-24 overflow-hidden section-pad">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_100%,#0d1c40_0%,#070E22_45%,#050816_80%)]" />
        <div className="lattice mask-fade-b absolute inset-0 opacity-50" />
        <ParticleField density={0.00011} speed={0.7} connect />
        <div className="aura anim-breathe bottom-[-30%] left-1/2 h-[46rem] w-[46rem] -translate-x-1/2 bg-blue/22" />
      </div>

      <div className="shell relative text-center">
        {/* Launch platform the headline sits on */}
        <div aria-hidden className="relative mx-auto mb-10 h-24 w-full max-w-2xl sm:mb-16 sm:h-32 [perspective:900px]">
          <motion.div
            className="absolute inset-x-0 bottom-0 mx-auto h-32 w-72 rounded-[50%] border border-cyan/25 bg-[radial-gradient(60%_60%_at_50%_50%,rgba(45,123,255,0.35),transparent_72%)]"
            style={{ transform: 'rotateX(74deg)' }}
            animate={reduce ? undefined : { opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          />
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute inset-x-0 bottom-0 mx-auto rounded-[50%] border border-cyan/20"
              style={{ transform: 'rotateX(74deg)' }}
              initial={{ width: '18rem', height: '8rem', opacity: 0.55 }}
              animate={
                reduce ? undefined : { width: '34rem', height: '15rem', opacity: 0 }
              }
              transition={{ duration: 4.5, repeat: Infinity, delay: i * 1.5, ease: 'easeOut' }}
            />
          ))}
          {/* The beam rising off the platform */}
          <motion.div
            className="absolute bottom-6 left-1/2 h-40 w-24 -translate-x-1/2 bg-[linear-gradient(180deg,transparent,rgba(85,230,255,0.28))] blur-2xl"
            animate={reduce ? undefined : { opacity: [0.4, 0.9, 0.4] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <RevealWords
          text={content.headline}
          className="mx-auto max-w-4xl font-display text-[clamp(2.25rem,5.4vw,4.25rem)] leading-[1.02] font-semibold text-glow"
        />

        <Reveal delay={0.2}>
          <p className="mx-auto mt-7 max-w-2xl text-[1.0625rem] leading-relaxed text-mute">
            {content.lede}
          </p>
        </Reveal>

        <Reveal delay={0.3}>
          <div className="mt-10 flex w-full flex-col items-stretch gap-3 sm:mt-11 sm:flex-row sm:flex-wrap sm:justify-center">
            <MagneticButton href={hubSignupUrl()} size="lg" className="w-full sm:w-auto">
              Get started
              <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </MagneticButton>
            <MagneticButton href="#demo" size="lg" variant="ghost" strength={0.2} className="w-full sm:w-auto">
              <MessageSquare className="h-4 w-4" />
              {content.ctaSecondary}
            </MagneticButton>
          </div>
        </Reveal>

        <Reveal delay={0.38}>
          <p className="eyebrow mt-10">{content.footnote}</p>
        </Reveal>
      </div>
    </section>
  );
}
