import { Link } from 'react-router-dom';
import type { ProfileStrength } from '../../lib/profile-strength';

type StrengthView = Pick<ProfileStrength, 'percent'>;

const OPEN_LINE = "You're nearly there, add a few more details to complete your profile.";

export function ProfileCompletionCard({
  strength,
  place,
}: {
  strength: StrengthView | null | undefined;
  place: 'profile' | 'dashboard';
}) {
  if (!strength) return null;
  const percent = Math.max(0, Math.min(100, Math.round(strength.percent)));
  if (place === 'dashboard' && percent >= 100) return null;

  const card = (
    <section
      className="rounded-xl border border-slate-200 dark:border-bg-border bg-white dark:bg-bg-card px-4 py-4"
      aria-label={`Profile ${percent}% complete`}
    >
      <div className="flex justify-between text-xs font-medium text-slate-500 mb-8">
        <span>0%</span>
        <span>100%</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-slate-200 dark:bg-white/15">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-slate-900 dark:bg-white"
          style={{ width: `${Math.max(percent, 2)}%` }}
        />
        <div
          className="absolute bottom-full mb-2 -translate-x-1/2"
          style={{ left: `clamp(1.6rem, ${percent}%, calc(100% - 1.6rem))` }}
        >
          <span className="profile-meter-num relative block rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold leading-none text-white dark:bg-white dark:text-slate-900">
            {percent}%
            <span className="absolute left-1/2 top-full -translate-x-1/2 border-x-[5px] border-t-[5px] border-x-transparent border-t-slate-900 dark:border-t-white" />
          </span>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-slate-600">
        {percent >= 100 ? 'Your profile is complete.' : OPEN_LINE}
      </p>
    </section>
  );

  if (place === 'dashboard') {
    const radius = 28;
    const turn = 2 * Math.PI * radius;
    const drawn = turn - (percent / 100) * turn;
    return (
      <Link to="/profile?tab=profile" className="home-strength" aria-label={`Profile ${percent}% complete`}>
        <span className="home-strength-ring">
          <svg viewBox="0 0 72 72" width="72" height="72" aria-hidden="true">
            <circle className="home-strength-track" cx="36" cy="36" r={radius} />
            <circle
              className="home-strength-arc"
              cx="36"
              cy="36"
              r={radius}
              strokeDasharray={turn}
              strokeDashoffset={drawn}
            />
          </svg>
          <span className="home-strength-num">{percent}%</span>
        </span>
        <span className="home-strength-line">{OPEN_LINE}</span>
      </Link>
    );
  }

  return card;
}
