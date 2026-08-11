import { About } from '@/components/About';
import { AnnouncementBar } from '@/components/AnnouncementBar';
import { ChooseUs } from '@/components/ChooseUs';
import { DemoBooking } from '@/components/DemoBooking';
import { Ecosystem } from '@/components/Ecosystem';
import { Faq } from '@/components/Faq';
import { Features } from '@/components/Features';
import { FinalCTA } from '@/components/FinalCTA';
import { Footer } from '@/components/Footer';
import { Hero } from '@/components/Hero';
import { Industries } from '@/components/Industries';
import { Lifecycle } from '@/components/Lifecycle';
import { Navbar } from '@/components/Navbar';
import { Problem } from '@/components/Problem';
import { ScrollProgress } from '@/components/ui/ScrollProgress';
import { Testimonials } from '@/components/Testimonials';
import { WhyPinithub } from '@/components/WhyPinithub';
import { getSiteContent } from '@/lib/content';

/** Always read CMS content from the database — dual-deploy admin edits must show live. */
export const dynamic = 'force-dynamic';

/**
 * The entire page is one read of the content database, handed down as props.
 * Nothing below this component talks to Prisma, so every section is a pure
 * function of its content row — which is what makes /admin able to change the
 * page without a deploy.
 */
export default async function Home() {
  const c = await getSiteContent();
  const on = (key: string) => c.sections[key]?.visible !== false;

  return (
    <>
      <ScrollProgress />
      <AnnouncementBar text={c.settings.announcement} href={c.settings.announcementHref} />
      <Navbar links={c.navLinks} ctaLabel={c.hero.ctaPrimary} />
      <main id="main">
        <Hero content={c.hero} />
        {on('about') && <About section={c.sections.about!} content={c.about} />}
        {on('problem') && <Problem section={c.sections.problem!} content={c.problem} />}
        {on('lifecycle') && <Lifecycle section={c.sections.lifecycle!} stages={c.lifecycle} />}
        {on('features') && <Features section={c.sections.features!} content={c.features} />}
        {on('ecosystem') && <Ecosystem section={c.sections.ecosystem!} products={c.ecosystem} />}
        {on('why') && <WhyPinithub section={c.sections.why!} cards={c.why} />}
        {on('chooseUs') && <ChooseUs section={c.sections.chooseUs!} reasons={c.chooseUs} />}
        {on('industries') && <Industries section={c.sections.industries!} industries={c.industries} />}
        {on('testimonials') && c.testimonials.length > 0 && (
          <Testimonials section={c.sections.testimonials!} quotes={c.testimonials} />
        )}
        {on('faq') && <Faq section={c.sections.faq!} items={c.faqs} />}
        <FinalCTA content={c.cta} />
        {on('demo') && (
          <DemoBooking
            section={c.sections.demo!}
            settings={c.settings}
            enabled={c.settings.demoFormEnabled}
          />
        )}
      </main>
      <Footer content={c.footer} settings={c.settings} />
    </>
  );
}
