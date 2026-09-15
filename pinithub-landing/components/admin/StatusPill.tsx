const TONE: Record<string, string> = {
  NEW: 'border-cyan/40 bg-cyan/10 text-cyan',
  CONTACTED: 'border-blue/40 bg-blue/10 text-blue',
  SCHEDULED: 'border-violet/40 bg-violet/10 text-violet',
  COMPLETED: 'border-signal/40 bg-signal/10 text-signal',
  REJECTED: 'border-red-400/40 bg-red-400/10 text-red-400',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium ${
        TONE[status] ?? 'border-line text-mute'
      }`}
    >
      {status}
    </span>
  );
}
