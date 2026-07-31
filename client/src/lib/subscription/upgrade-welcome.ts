import type { PlanCode } from '../../hooks/useSubscription';

const KEY_PREFIX = 'pinit_upgrade_welcome_';

export function shouldShowUpgradeWelcome(userId: string, planCode: PlanCode): boolean {
  if (planCode === 'FREE') return false;
  try {
    return localStorage.getItem(`${KEY_PREFIX}${userId}_${planCode}`) !== '1';
  } catch {
    return false;
  }
}

export function markUpgradeWelcomeSeen(userId: string, planCode: PlanCode): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${userId}_${planCode}`, '1');
  } catch { /* ignore */ }
}

export function setPendingUpgradeWelcome(userId: string, planCode: PlanCode): void {
  try {
    sessionStorage.setItem(`${KEY_PREFIX}pending_${userId}`, planCode);
  } catch { /* ignore */ }
}

export function consumePendingUpgradeWelcome(userId: string): PlanCode | null {
  try {
    const key = `${KEY_PREFIX}pending_${userId}`;
    const code = sessionStorage.getItem(key) as PlanCode | null;
    if (code) sessionStorage.removeItem(key);
    return code;
  } catch {
    return null;
  }
}
