/**
 * Profile strength visuals: the ring around the avatar, the header pill and
 * the checklist rail on the Profile tab. Scoring lives in lib/profile-strength.
 */
import { BadgeCheck, Check, ChevronRight, Sparkles, Zap } from 'lucide-react';
import type { ProfileStrength, StrengthItemId, StrengthTier } from '../../lib/profile-strength';

const TIER_STYLE: Record<StrengthTier, { ring: string; pill: string; bar: string }> = {
  starting: {
    ring: 'text-amber-500',
    pill: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:border-amber-500/30',
    bar: 'bg-amber-500',
  },
  progress: {
    ring: 'text-dna-500',
    pill: 'bg-dna-50 text-dna-700 border-dna-100 dark:bg-dna-500/10 dark:text-dna-400 dark:border-dna-500/30',
    bar: 'bg-dna-500',
  },
  almost: {
    ring: 'text-dna-500',
    pill: 'bg-dna-50 text-dna-700 border-dna-100 dark:bg-dna-500/10 dark:text-dna-400 dark:border-dna-500/30',
    bar: 'bg-dna-500',
  },
  complete: {
    ring: 'text-emerald-500',
    pill: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
    bar: 'bg-emerald-500',
  },
};

function TierIcon({ tier, size = 12 }: { tier: StrengthTier; size?: number }) {
  if (tier === 'complete') return <BadgeCheck size={size} />;
  if (tier === 'starting') return <Zap size={size} />;
  return <Sparkles size={size} />;
}

/** A progress ring drawn around whatever it wraps (the avatar, or a number). */
export function StrengthRing({
  percent,
  tier,
  size,
  stroke = 4,
  children,
  label,
}: {
  percent: number;
  tier: StrengthTier;
  size: number;
  stroke?: number;
  children: React.ReactNode;
  label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-200 dark:stroke-white/10" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          className={`${TIER_STYLE[tier].ring} transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none`}
        />
      </svg>
      <div className="absolute flex items-center justify-center" style={{ inset: stroke + 3 }}>
        {children}
      </div>
    </div>
  );
}

export function StrengthPill({ strength, onClick }: { strength: ProfileStrength; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-2xs font-semibold tabular-nums transition-colors hover:brightness-95 ${TIER_STYLE[strength.tier].pill}`}
    >
      <TierIcon tier={strength.tier} />
      Profile {strength.percent}% · {strength.tierLabel}
    </button>
  );
}

/** The checklist rail. `onGo` takes the user to the field or card for an item. */
export function StrengthPanel({
  strength,
  onGo,
}: {
  strength: ProfileStrength;
  onGo: (id: StrengthItemId) => void;
}) {
  const style = TIER_STYLE[strength.tier];
  const next = strength.nextStep;
  return (
    <div className="card !p-5 space-y-4">
      <div className="flex items-center gap-4">
        <StrengthRing percent={strength.percent} tier={strength.tier} size={68} stroke={6} label={`Profile ${strength.percent}% complete`}>
          <span className="text-base font-bold text-slate-900 dark:text-white tabular-nums">{strength.percent}%</span>
        </StrengthRing>
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400">Profile strength</p>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{strength.tierLabel}</p>
          {strength.missingRequired.length > 0 && (
            <p className="text-2xs text-amber-700 dark:text-amber-300 mt-0.5">
              {strength.missingRequired.length} required {strength.missingRequired.length === 1 ? 'field' : 'fields'} missing
            </p>
          )}
        </div>
      </div>

      {next && (
        <button
          type="button"
          onClick={() => onGo(next.id)}
          className="w-full text-left rounded-xl border border-dna-100 dark:border-dna-500/30 bg-dna-50/70 dark:bg-dna-500/10 px-3 py-2.5 hover:border-dna-400 transition-colors group"
        >
          <p className="text-2xs font-semibold uppercase tracking-wider text-dna-700 dark:text-dna-400">Next best step</p>
          <p className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1 mt-0.5">
            Add {next.label.toLowerCase()}
            <span className="ml-auto text-2xs font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">+{next.weight}%</span>
            <ChevronRight size={13} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </p>
          <p className="text-2xs text-slate-500 dark:text-gray-400 mt-0.5">{next.hint}</p>
        </button>
      )}

      <div className="space-y-3.5">
        {strength.groups.map((g) => (
          <div key={g.id}>
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-xs font-semibold text-slate-800 dark:text-gray-200">{g.label}</p>
              <p className="text-2xs text-slate-500 dark:text-gray-400 tabular-nums">{g.earned}/{g.max}</p>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full ${g.earned === g.max ? 'bg-emerald-500' : style.bar} transition-[width] duration-500 motion-reduce:transition-none`}
                style={{ width: `${g.max ? (g.earned / g.max) * 100 : 0}%` }}
              />
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {strength.items.filter((it) => it.group === g.id).map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => onGo(it.id)}
                    className="w-full flex items-center gap-2 text-left text-xs py-1 px-1 -mx-1 rounded-md hover:bg-slate-50 dark:hover:bg-white/5"
                  >
                    <span
                      className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                        it.done
                          ? 'bg-emerald-500 text-white'
                          : 'border border-slate-300 dark:border-gray-600'
                      }`}
                    >
                      {it.done && <Check size={10} strokeWidth={3} />}
                    </span>
                    <span className={it.done ? 'text-slate-500 dark:text-gray-400' : 'text-slate-800 dark:text-gray-200'}>
                      {it.label}
                    </span>
                    {it.skipped && <span className="text-2xs text-slate-400">Not used</span>}
                    {!it.done && it.required && (
                      <span className="text-2xs font-semibold text-amber-700 dark:text-amber-300">Required</span>
                    )}
                    {!it.done && (
                      <span className="ml-auto text-2xs font-semibold text-slate-400 dark:text-gray-500 tabular-nums">+{it.weight}%</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
