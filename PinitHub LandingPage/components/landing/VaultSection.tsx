import { CAPABILITY_SECTIONS } from '@/lib/landing-content';
import { CapabilityBlock } from './CapabilityBlock';
import { VaultMock } from './mockups';

export function VaultSection() {
  const c = CAPABILITY_SECTIONS.vault;
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
      mockup={<VaultMock />}
      reverse
    />
  );
}
