const STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-950/50 text-emerald-400 border-emerald-900/50',
  REVOKED: 'bg-red-950/50 text-red-400 border-red-900/50',
  INACTIVE: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  PENDING: 'bg-amber-950/50 text-amber-400 border-amber-900/50',
  TAMPERED: 'bg-red-950/50 text-red-400 border-red-900/50',
  INVESTIGATED: 'bg-blue-950/50 text-blue-400 border-blue-900/50',
  SUPER_ADMIN: 'bg-violet-950/50 text-violet-300 border-violet-900/50',
  ADMIN: 'bg-indigo-950/50 text-indigo-300 border-indigo-900/50',
  USER: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  HIGH: 'bg-red-950/50 text-red-400 border-red-900/50',
  LOW: 'bg-emerald-950/50 text-emerald-400 border-emerald-900/50',
};

export function StatusBadge({ value }: { value: string }) {
  const style = STYLES[value] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${style}`}>
      {value}
    </span>
  );
}
