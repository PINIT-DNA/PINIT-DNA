'use client';

import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { ArrowUpRight, Play, Sparkles } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import type { SiteContent } from '@/lib/content';
import { DEMO_VIDEO_URL, hubSignupUrl } from '@/lib/site';
import { MagneticButton } from './ui/MagneticButton';
import { ParticleField } from './ui/ParticleField';
import { VideoModal } from './ui/VideoModal';

// WebGL is client-only and heavy: keep it out of the server bundle and off the
// critical path so first paint is the text, not the canvas.
const CoreScene = dynamic(() => import('./hero/CoreScene'), { ssr: false });

type HeroContent = SiteContent['hero'];

export function Hero({ content }: { content: HeroContent }) {
  const LOGOS = content.logos;
  const videoUrl = (content.videoUrl || DEMO_VIDEO_URL).trim();
  const stats: [string, string][] = [
    [content.stat1Key, content.stat1Value],
    [content.stat2Key, content.stat2Value],
    [content.stat3Key, content.stat3Value],
  ];

  const [videoOpen, setVideoOpen] = useState(false);

  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });

  const copyY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 90]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.72], [1, 0]);
  const sceneScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 1.12]);

  return (
    <section id="hero" ref={ref} className="relative isolate overflow-hidden pt-14 sm:pt-[4.5rem]">
      {/* ---- Ambient backdrop ---- */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(120%_88%_at_72%_18%,#0d1c3d_0%,#070E22_42%,#050816_78%)]" />
        <div className="lattice mask-radial absolute inset-0 opacity-70" />
        <div className="aura anim-drift top-[-14%] right-[6%] h-[42rem] w-[42rem] bg-blue/14" />
        <div className="aura anim-breathe bottom-[-24%] left-[-8%] h-[38rem] w-[38rem] bg-violet/10" />
        <div className="aura top-[26%] right-[26%] h-[22rem] w-[22rem] bg-cyan/8" />
        <ParticleField density={0.00005} speed={0.7} />
        {/* Soft light — restrained, not neon wash */}
        <div className="absolute inset-0 overflow-hidden opacity-[0.12]">
          <div className="absolute -top-1/2 left-1/3 h-[200%] w-[36rem] -rotate-[18deg] bg-[linear-gradient(90deg,transparent,rgba(85,230,255,0.12),transparent)] blur-3xl" />
          <div className="absolute -top-1/2 left-2/3 h-[200%] w-[24rem] -rotate-[12deg] bg-[linear-gradient(90deg,transparent,rgba(111,92,255,0.10),transparent)] blur-3xl" />
        </div>
      </div>

      <div className="shell relative grid min-h-[calc(100svh-3.5rem)] items-center gap-8 pt-8 pb-12 sm:min-h-[calc(100svh-4.5rem)] sm:gap-12 sm:pt-14 sm:pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-6 lg:pt-0 lg:pb-0">
        {/* ---- Copy ---- */}
        <motion.div style={{ y: copyY, opacity: copyOpacity }} className="relative z-10 max-w-2xl">
          <motion.a
            href="#platform"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="group inline-flex max-w-full flex-col items-start gap-2 rounded-2xl border border-line bg-white/[0.03] p-2 backdrop-blur-sm transition-colors hover:border-cyan/30 hover:bg-white/[0.06] min-[420px]:flex-row min-[420px]:items-center min-[420px]:rounded-full min-[420px]:py-1.5 min-[420px]:pr-4 min-[420px]:pl-1.5"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(100deg,#55E6FF,#2D7BFF)] px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.14em] text-ink uppercase">
              <Sparkles className="h-3 w-3" />
              {content.badgeLabel}
            </span>
            <span className="px-1 text-[0.8125rem] leading-snug text-mute min-[420px]:px-0">{content.badgeText}</span>
            <ArrowUpRight className="hidden h-3.5 w-3.5 shrink-0 text-mute-2 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 min-[420px]:block" />
          </motion.a>

          <h1 className="mt-6 font-display text-[clamp(2rem,8.5vw,5.25rem)] leading-[0.98] font-semibold sm:mt-8">
            <RevealLine delay={0.34}>
              <span className="text-glow">{content.headline1}</span>
            </RevealLine>
            {content.headline2 ? (
              <RevealLine delay={0.44}>
                <span className="text-beam">{content.headline2}</span>
              </RevealLine>
            ) : null}
            {content.headline3 ? (
              <RevealLine delay={0.52}>
                <span className="text-beam">{content.headline3}</span>
              </RevealLine>
            ) : null}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.66, ease: [0.16, 1, 0.3, 1] }}
            className="mt-7 max-w-xl text-[1.0625rem] leading-[1.7] text-mute"
          >
            {content.lede}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.78, ease: [0.16, 1, 0.3, 1] }}
            className="mt-8 flex w-full flex-col gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center"
          >
            <MagneticButton href={hubSignupUrl()} size="lg" className="w-full sm:w-auto">
              Get started
              <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </MagneticButton>
            <MagneticButton href="#how-it-works" size="lg" variant="ghost" strength={0.2} className="w-full sm:w-auto">
              {content.ctaSecondary}
            </MagneticButton>
            {videoUrl ? (
              <MagneticButton onClick={() => setVideoOpen(true)} size="lg" variant="quiet" strength={0.15} className="w-full sm:w-auto">
                <span className="grid h-7 w-7 place-items-center rounded-full border border-line bg-white/[0.03]">
                  <Play className="h-3 w-3 fill-mute text-mute" />
                </span>
                Watch demo
              </MagneticButton>
            ) : null}
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.88 }}
            className="eyebrow mt-8 tracking-[0.18em] text-mute-2"
          >
            Protect · Prove · Share · Detect · Investigate
          </motion.p>

          <motion.dl
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.95 }}
            className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 border-t border-line pt-6 min-[420px]:grid-cols-2 sm:mt-10 sm:flex sm:flex-wrap sm:gap-x-10 sm:pt-8"
          >
            {stats.map(([k, v]) => (
              <div key={k}>
                <dt className="font-display text-lg font-semibold text-paper">{k}</dt>
                <dd className="eyebrow mt-1.5">{v}</dd>
              </div>
            ))}
          </motion.dl>
        </motion.div>

        {/* ---- 3D core ---- */}
        <motion.div
          style={{ scale: sceneScale }}
          className="relative z-0 -mx-4 h-[20rem] sm:-mx-6 sm:h-[28rem] lg:mx-0 lg:h-[min(84svh,46rem)]"
        >
          <div className="absolute inset-0">
            <CoreScene />
          </div>

          {/* Instrument readouts pinned around the core. `position` is a stored
              Tailwind placement string, so the admin panel can move them. */}
          {content.readouts.map((r, i) => (
            <Readout
              key={r.id}
              className={r.position}
              label={r.label}
              value={r.value}
              accent={r.accent}
              delay={1.2 + i * 0.12}
            />
          ))}
        </motion.div>
      </div>

      {LOGOS.length > 0 && (
        <div className="relative border-t border-line">
          <div className="shell py-8">
            <div className="flex flex-col items-center gap-6 lg:flex-row lg:gap-12">
              <p className="eyebrow shrink-0">{content.logosLabel}</p>
              <div className="marquee-mask relative w-full overflow-hidden">
                <div
                  className="anim-marquee flex w-max items-center gap-14"
                  style={{ ['--marquee-duration' as string]: '38s' }}
                >
                  {[...LOGOS, ...LOGOS].map((name, i) => (
                    <span
                      key={`${name}-${i}`}
                      aria-hidden={i >= LOGOS.length}
                      className="font-display text-[0.9375rem] font-semibold tracking-[0.22em] whitespace-nowrap text-mute-2/70 transition-colors duration-300 hover:text-mute"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {videoOpen && videoUrl && <VideoModal url={videoUrl} onClose={() => setVideoOpen(false)} />}
    </section>
  );
}

function RevealLine({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <span className="block overflow-hidden pb-[0.06em]">
      <motion.span
        className="block"
        initial={{ y: '108%' }}
        animate={{ y: '0%' }}
        transition={{ duration: 1.05, delay, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.span>
    </span>
  );
}

function Readout({
  className = '',
  label,
  value,
  accent = false,
  delay = 1.2,
}: {
  className?: string;
  label: string;
  value: string;
  accent?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`pointer-events-none absolute hidden rounded-xl border border-line bg-ink-2/60 px-3.5 py-2.5 backdrop-blur-md xl:block ${className}`}
    >
      <span className="pin-cross -top-[5px] -left-[5px]" />
      <p className="eyebrow text-[0.625rem]">{label}</p>
      <p
        className={`mt-1 font-mono text-[0.8125rem] font-medium ${accent ? 'text-signal' : 'text-paper'}`}
      >
        {value}
      </p>
    </motion.div>
  );
}
