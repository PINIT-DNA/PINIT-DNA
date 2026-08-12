import { CAPABILITY_SECTIONS } from '@/lib/landing-content';
import { CapabilityBlock } from './CapabilityBlock';
import { DnaEvidenceMock } from './mockups';

export function DNASection() {
  const c = CAPABILITY_SECTIONS.dna;
  return (
    <CapabilityBlock
      anchorId="capabilities"
      id={c.id}
      index={c.index}
      label={c.label}
      title={c.title}
      lede={c.lede}
      points={c.points}
      status={c.status}
      mockupTitle={c.mockupTitle}
      mockup={<DnaEvidenceMock />}
    />
  );
}
