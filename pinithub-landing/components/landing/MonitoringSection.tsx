import { CAPABILITY_SECTIONS } from '@/lib/landing-content';
import { CapabilityBlock } from './CapabilityBlock';
import { MonitoringMock } from './mockups';

export function MonitoringSection() {
  const c = CAPABILITY_SECTIONS.monitoring;
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
      mockup={<MonitoringMock />}
      reverse
    />
  );
}
