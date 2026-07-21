import { Check, Minus } from 'lucide-react';
import { COMPARISON_ROWS } from '../../lib/subscription/plans';
import { cn } from '../ui/utils';

function CellValue({ value }: { value: string | boolean }) {
  if (value === true) {
    return <Check size={16} className="text-emerald-400 mx-auto" />;
  }
  if (value === false) {
    return <Minus size={16} className="text-gray-600 mx-auto" />;
  }
  return <span className="text-xs text-gray-300">{value}</span>;
}

export function PlanComparisonTable({
  highlightPlan,
  showEnterprise = true,
}: {
  highlightPlan?: 'PRO' | 'ENTERPRISE';
  showEnterprise?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-bg-border bg-bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-bg-border bg-bg-elevated/50">
              <th className="text-left p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Feature
              </th>
              <th className="p-4 text-center text-xs font-semibold text-gray-500">Free</th>
              <th
                className={cn(
                  'p-4 text-center text-xs font-semibold',
                  highlightPlan === 'PRO' ? 'text-amber-400 bg-amber-500/5' : 'text-gray-500',
                )}
              >
                Pro
              </th>
              {showEnterprise && (
                <th
                  className={cn(
                    'p-4 text-center text-xs font-semibold',
                    highlightPlan === 'ENTERPRISE' ? 'text-purple-400 bg-purple-500/5' : 'text-gray-500',
                  )}
                >
                  Enterprise
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => (
              <tr key={row.label} className="border-b border-bg-border/80 last:border-0">
                <td className="p-3 pl-4 text-gray-300 font-medium">{row.label}</td>
                <td className="p-3 text-center"><CellValue value={row.free} /></td>
                <td
                  className={cn('p-3 text-center', highlightPlan === 'PRO' && 'bg-amber-500/[0.03]')}
                >
                  <CellValue value={row.pro} />
                </td>
                {showEnterprise && (
                  <td
                    className={cn('p-3 text-center', highlightPlan === 'ENTERPRISE' && 'bg-purple-500/[0.03]')}
                  >
                    <CellValue value={row.enterprise} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
