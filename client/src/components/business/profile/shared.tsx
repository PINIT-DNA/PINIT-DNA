import type { ReactNode } from 'react';

export function EnterpriseCard({
  title,
  icon,
  children,
  className = '',
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#181a1f] dark:shadow-lg dark:shadow-black/20 ${className}`}
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
        <span className="text-violet-700 dark:text-blue-400">{icon}</span>
        {title}
      </h2>
      {children}
    </div>
  );
}

export function EnterpriseField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  type = 'text',
  hint,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-xs text-slate-600 dark:text-gray-300 font-semibold mb-1.5 block uppercase tracking-wide">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        disabled={disabled}
        placeholder={placeholder}
        className={`w-full px-3 py-2.5 bg-slate-50 dark:bg-bg-elevated border border-slate-300 dark:border-bg-border rounded-xl text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-violet-600 focus:ring-2 focus:ring-violet-500/30 transition-colors ${
          disabled ? 'opacity-70 cursor-not-allowed bg-slate-100 dark:opacity-60' : ''
        }`}
      />
      {hint && <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

export function EnterpriseSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-slate-600 dark:text-gray-300 font-semibold mb-1.5 block uppercase tracking-wide">
        {label}
      </label>
      <select
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        disabled={disabled}
        className="w-full px-3 py-2.5 bg-slate-50 dark:bg-bg-elevated border border-slate-300 dark:border-bg-border rounded-xl text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-600 disabled:opacity-60"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function EnterpriseStat({
  label,
  value,
  sub,
  accent = 'purple',
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'purple' | 'dna' | 'amber' | 'green';
}) {
  const tones = {
    purple: 'border-violet-200 bg-violet-50 dark:border-blue-500/25 dark:bg-blue-500/10',
    dna: 'border-cyan-200 bg-cyan-50 dark:border-cyan-500/25 dark:bg-cyan-500/10',
    amber: 'border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10',
    green: 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/10',
  };
  return (
    <div className={`rounded-xl border p-3.5 text-center ${tones[accent]}`}>
      <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</p>
      <p className="text-xs text-slate-700 dark:text-gray-300 mt-1 font-semibold">{label}</p>
      {sub && <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export function EnterpriseBadge({
  children,
  tone = 'purple',
}: {
  children: ReactNode;
  tone?: 'purple' | 'green' | 'amber';
}) {
  const cls =
    tone === 'green'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30'
      : tone === 'amber'
        ? 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'
        : 'bg-violet-100 text-violet-900 border-violet-300 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
}

export function ComingSoonTile({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-bg-border dark:bg-bg-elevated/40">
      <span className="text-slate-500 dark:text-gray-400">{icon}</span>
      <span className="text-xs text-slate-700 dark:text-gray-300 text-center font-medium">{label}</span>
      <span className="text-xs text-violet-700 dark:text-purple-300 font-semibold">Coming soon</span>
    </div>
  );
}

/** High-contrast primary action — forces white label on purple in light + dark */
export function EnterpriseButton({
  children,
  onClick,
  type = 'button',
  disabled,
  variant = 'primary',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
}) {
  const styles =
    variant === 'secondary'
      ? 'bg-white text-slate-800 border-2 border-slate-300 hover:bg-slate-50 dark:bg-bg-elevated dark:text-white dark:border-bg-border'
      : variant === 'danger'
        ? 'bg-red-600 text-white border border-red-700 hover:bg-red-500'
        : 'bg-violet-700 text-white border border-violet-800 hover:bg-violet-600 shadow-md shadow-violet-900/20';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 ${styles} ${className}`}
      style={variant === 'primary' || variant === 'danger' ? { color: '#ffffff' } : undefined}
    >
      {children}
    </button>
  );
}

export function SaveBar({
  saving,
  saved,
  onSave,
}: {
  saving: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-10 flex justify-end">
      <EnterpriseButton onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
      </EnterpriseButton>
    </div>
  );
}
