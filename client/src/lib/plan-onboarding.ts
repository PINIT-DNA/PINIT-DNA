const KEY_PREFIX = 'pinit_plan_choice_';

export function hasCompletedPlanChoice(userId: string): boolean {
  try {
    return localStorage.getItem(`${KEY_PREFIX}${userId}`) === '1';
  } catch {
    return false;
  }
}

export function markPlanChoiceComplete(userId: string): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${userId}`, '1');
  } catch { /* privacy mode */ }
}

export function buildUpgradeUrl(opts: {
  from?: 'login' | 'feature' | 'quota';
  feature?: string;
  label?: string;
  returnTo?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.feature) params.set('feature', opts.feature);
  if (opts.label) params.set('label', opts.label);
  if (opts.returnTo) params.set('return', opts.returnTo);
  const qs = params.toString();
  return qs ? `/upgrade?${qs}` : '/upgrade';
}
