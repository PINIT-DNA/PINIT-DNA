import type { LucideIcon } from 'lucide-react';

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  trend?: 'up' | 'down' | 'neutral';
}

export function StatCard({ label, value, sub, icon: Icon }: Props) {
  return (
    <div className="bg-[#111113] border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">{label}</p>
          <p className="text-2xl font-semibold text-zinc-100 mt-1 tabular-nums">{value}</p>
          {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
        </div>
        {Icon && (
          <div className="p-2 rounded-md bg-zinc-900 border border-zinc-800 shrink-0">
            <Icon size={18} className="text-zinc-400" />
          </div>
        )}
      </div>
    </div>
  );
}
