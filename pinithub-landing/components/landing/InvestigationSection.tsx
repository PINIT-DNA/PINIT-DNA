import { CAPABILITY_SECTIONS } from '@/lib/landing-content';
import { CapabilityBlock } from './CapabilityBlock';
import { InvestigationMock } from './mockups';

export function InvestigationSection() {
  const c = CAPABILITY_SECTIONS.investigation;
  return (
    <CapabilityBlock
      id={c.id}
      index={c.index}
      label={c.label}
      title={c.title}
      lede={c.lede}
      points={c.points}
      status={c.status}
      mockupTitle={c.mockupTitle}
      mockup={<InvestigationMock />}
    />
  );
}
