import type { LucideIcon } from 'lucide-react';

interface Props {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
}

export function LightStatCard({ label, value, sub, icon: Icon }: Props) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">{label}</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
        {Icon && (
          <div className="p-2 rounded-lg bg-indigo-50 shrink-0">
            <Icon size={18} className="text-indigo-600" />
          </div>
        )}
      </div>
    </div>
  );
}
