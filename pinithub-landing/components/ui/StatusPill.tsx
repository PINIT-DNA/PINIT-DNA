import type { StatusKind } from '@/lib/landing-content';

const MAP: Record<StatusKind, { label: string; className: string }> = {
  available: {
    label: 'Available now',
    className: 'border-signal/35 bg-signal/10 text-signal',
  },
  roadmap: {
    label: 'Coming soon',
    className: 'border-line bg-white/[0.03] text-mute-2',
  },
  partial: {
    label: 'Partial',
    className: 'border-[color:var(--color-warn)]/35 bg-[color:var(--color-warn)]/10 text-[color:var(--color-warn)]',
  },
};

export function StatusPill({ status }: { status: StatusKind }) {
  const s = MAP[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.625rem] font-semibold tracking-[0.14em] uppercase ${s.className}`}
    >
      {s.label}
    </span>
  );
}
