import { CAPABILITY_SECTIONS } from '@/lib/landing-content';
import { CapabilityBlock } from './CapabilityBlock';
import { SmartShareMock } from './mockups';

export function SmartShareSection() {
  const c = CAPABILITY_SECTIONS.share;
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
      mockup={<SmartShareMock />}
    />
  );
}
