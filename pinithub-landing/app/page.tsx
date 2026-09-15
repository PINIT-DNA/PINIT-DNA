import {
  AssetEvidenceFlow,
  DNASection,
  EnterpriseCTA,
  Footer,
  Hero,
  InvestigationSection,
  MonitoringSection,
  Navbar,
  PlatformLoop,
  ProductStatus,
  SecuritySection,
  SmartShareSection,
  UseCases,
  VaultSection,
  Workflow,
} from '@/components/landing';
import { DemoBooking } from '@/components/DemoBooking';
import { ScrollProgress } from '@/components/ui/ScrollProgress';
import { getSiteContent } from '@/lib/content';

/** Public marketing page — enterprise IA. Demo form still uses CMS settings + API. */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const c = await getSiteContent();
  const demoOn = c.sections.demo?.visible !== false;

  return (
    <>
      <ScrollProgress />
      <Navbar />
      <main id="main">
        <Hero />
        <PlatformLoop />
        <Workflow />
        <AssetEvidenceFlow />
        <DNASection />
        <VaultSection />
        <SmartShareSection />
        <MonitoringSection />
        <InvestigationSection />
        <SecuritySection />
        <UseCases />
        <ProductStatus />
        <EnterpriseCTA />
        {demoOn && c.sections.demo ? (
          <DemoBooking
            section={c.sections.demo}
            settings={c.settings}
            enabled={c.settings.demoFormEnabled}
          />
        ) : null}
      </main>
      <Footer />
    </>
  );
}
