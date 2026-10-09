import type { LucideIcon } from 'lucide-react';

/**
 * Premium empty-state shell for the Sharing page's five tabs. Purely visual
 * (soft glow + two faint orbit rings behind the existing icon/title/
 * description) — the text passed in is exactly the same copy each tab
 * already rendered; nothing here fabricates data or adds new claims.
 */
export function ShareEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="shr-empty">
      <div className="shr-empty-ring" aria-hidden="true" />
      <div className="shr-empty-ring shr-empty-ring--2" aria-hidden="true" />
      <div className="shr-empty-icon" aria-hidden="true">
        <Icon size={26} />
      </div>
      <p className="text-sm font-semibold text-slate-700 relative z-10">{title}</p>
      <p className="text-2xs text-gray-500 mt-1.5 max-w-sm mx-auto relative z-10">{description}</p>
    </div>
  );
}
