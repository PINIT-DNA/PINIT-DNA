/**
 * Shared shell pieces for the Business Account Client/Campaign screens.
 * Mirrors the dashboard's existing SectionCard / MetricTile visual language so
 * these screens read as the same product, not a bolted-on module.
 */
import { Link } from 'react-router-dom';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../ui/utils';

/** Page wrapper — same width/padding rhythm as BusinessDashboardPage. */
export function BusinessPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[1400px] mx-auto p-4 sm:p-6 space-y-5 pb-16 animate-fade-in">
      {children}
    </div>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 flex-wrap text-xs text-gray-500 mb-2 min-w-0">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex items-center gap-1 min-w-0">
          {i > 0 && <ChevronRight size={12} className="shrink-0 opacity-60" />}
          {c.to ? (
            <Link to={c.to} className="hover:text-dna-400 transition-colors truncate max-w-[160px]">
              {c.label}
            </Link>
          ) : (
            <span className="text-gray-400 truncate max-w-[220px]">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Card shell — matches the dashboard's SectionCard. */
export function SectionCard({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-bg-border bg-bg-card overflow-hidden', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-bg-border/80">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 min-w-0">
            {Icon && <Icon size={15} className="text-dna-400 shrink-0" />}
            <span className="truncate">{title}</span>
          </h3>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

const ACCENTS = {
  dna: 'text-dna-400 bg-dna-500/10 border-dna-500/20',
  emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  purple: 'text-purple bg-purple/10 border-purple/20',
  rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  cyan: 'text-cyan bg-cyan/10 border-cyan/20',
} as const;

export type Accent = keyof typeof ACCENTS;

/** Stat tile — matches the dashboard's MetricTile. */
export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'dna',
  to,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: LucideIcon;
  accent?: Accent;
  to?: string;
}) {
  const body = (
    <div className={cn('rounded-xl border p-3.5 h-full transition-colors', ACCENTS[accent], to && 'hover:bg-bg-elevated/50')}>
      {Icon && (
        <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2 bg-bg-card/40">
          <Icon size={15} />
        </div>
      )}
      <p className="text-2xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold text-white mt-0.5 tabular-nums">{value}</p>
      {sub && <p className="text-2xs text-gray-500 mt-0.5 truncate">{sub}</p>}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
}

/** Lighter-weight empty hint for inside a section card. */
export function EmptyHint({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-bg-border bg-bg-elevated/40 px-4 py-8 text-center">
      <p className="text-xs text-gray-500">{text}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-11 rounded-lg bg-bg-elevated animate-pulse" />
      ))}
    </div>
  );
}

export function SkeletonTiles({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-[86px] rounded-xl bg-bg-elevated animate-pulse" />
      ))}
    </div>
  );
}

/** Full-page error with a way back — never a blank screen. */
export function PageError({ message, backTo, backLabel }: { message: string; backTo: string; backLabel: string }) {
  return (
    <BusinessPage>
      <div className="rounded-xl border border-danger/30 bg-danger/5 p-8 text-center">
        <p className="text-sm text-danger font-medium mb-4">{message}</p>
        <Link to={backTo} className="btn btn-secondary btn-sm">{backLabel}</Link>
      </div>
    </BusinessPage>
  );
}

/** Tab bar — same query-param pattern as the Organization Profile hub. */
export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; icon?: LucideIcon; soon?: boolean; count?: number }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin" role="tablist">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={cn(
              'shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold rounded-xl transition-all whitespace-nowrap border min-h-[42px]',
              isActive
                ? 'bg-dna-500 text-white border-dna-600 shadow-sm'
                : 'text-gray-400 bg-bg-card border-bg-border hover:text-white hover:border-dna-500/30',
              t.soon && !isActive && 'opacity-60',
            )}
          >
            {t.icon && <t.icon size={14} />}
            {t.label}
            {typeof t.count === 'number' && t.count > 0 && (
              <span className={cn('mono text-2xs', isActive ? 'opacity-80' : 'opacity-60')}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Placeholder for tabs whose backend lands in a later phase. */
export function ComingSoonPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-bg-border bg-bg-elevated/40 px-6 py-14 text-center">
      <p className="text-sm font-semibold text-gray-300">{title}</p>
      <p className="text-xs text-gray-500 mt-1.5 max-w-sm mx-auto">{detail}</p>
    </div>
  );
}
