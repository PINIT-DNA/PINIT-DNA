import { DemoBooking } from '@/components/DemoBooking';
import {
  Business,
  DemoProvider,
  Exchange,
  FileTypes,
  Final,
  Footer,
  Hero,
  Nav,
  Problem,
  Product,
  Security,
  Ticker,
  Tracking,
  Verify,
  Who,
} from '@/components/lp';
import { getSiteContent } from '@/lib/content';
import './landing.css';

/**
 * Public landing page. Story: what PINIT does (hero) → the problem → live
 * tracking → verifying ownership → the product → file types → security →
 * business → exchange → use cases → book a demo → close.
 * The demo-request form is still the CMS-driven component.
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const c = await getSiteContent();
  const demoOn = c.sections.demo?.visible !== false && Boolean(c.sections.demo);

  return (
    <div className="lp">
      <DemoProvider>
        <a className="skip" href="#main">Skip to content</a>
        <Nav />
        <main id="top">
          <div id="main" />
          <Hero />
          <Ticker />
          <Problem />
          <Tracking />
          <Verify />
          <Product />
          <FileTypes />
          <Security />
          <Business />
          <Exchange />
          <Who />
          {demoOn && c.sections.demo ? (
            <div className="lp-booking">
              <DemoBooking section={c.sections.demo} settings={c.settings} enabled={c.settings.demoFormEnabled} />
            </div>
          ) : null}
          <Final />
        </main>
        <Footer contact={demoOn} />
      </DemoProvider>
    </div>
  );
}
