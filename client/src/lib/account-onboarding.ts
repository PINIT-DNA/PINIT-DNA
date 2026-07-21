import type { AccountType } from './account-type';

const ACCOUNT_TYPE_KEY_PREFIX = 'pinit_account_type_done_';
const BUSINESS_SETUP_KEY_PREFIX = 'pinit_business_setup_done_';
const CHOSEN_TYPE_KEY_PREFIX = 'pinit_chosen_account_type_';

export function hasCompletedAccountTypeOnboarding(userId: string): boolean {
  try {
    return localStorage.getItem(`${ACCOUNT_TYPE_KEY_PREFIX}${userId}`) === '1';
  } catch {
    return false;
  }
}

export function markAccountTypeOnboardingComplete(userId: string): void {
  try {
    localStorage.setItem(`${ACCOUNT_TYPE_KEY_PREFIX}${userId}`, '1');
  } catch { /* privacy mode */ }
}

export function clearAccountTypeOnboarding(userId: string): void {
  try {
    localStorage.removeItem(`${ACCOUNT_TYPE_KEY_PREFIX}${userId}`);
  } catch { /* privacy mode */ }
}

export function setChosenAccountType(userId: string, type: AccountType): void {
  try {
    localStorage.setItem(`${CHOSEN_TYPE_KEY_PREFIX}${userId}`, type);
  } catch { /* privacy mode */ }
}

export function getChosenAccountType(userId: string): AccountType | null {
  try {
    const value = localStorage.getItem(`${CHOSEN_TYPE_KEY_PREFIX}${userId}`);
    if (value === 'BUSINESS' || value === 'INDIVIDUAL') return value;
    return null;
  } catch {
    return null;
  }
}

export function clearChosenAccountType(userId: string): void {
  try {
    localStorage.removeItem(`${CHOSEN_TYPE_KEY_PREFIX}${userId}`);
  } catch { /* privacy mode */ }
}

/** Prefer explicit user choice (localStorage) over JWT while onboarding is in flight. */
export function resolveEffectiveAccountType(
  userId: string | undefined,
  jwtAccountType?: AccountType,
): AccountType {
  if (userId) {
    const chosen = getChosenAccountType(userId);
    if (chosen) return chosen;
  }
  return jwtAccountType ?? 'INDIVIDUAL';
}

export function hasCompletedBusinessSetup(userId: string): boolean {
  try {
    return localStorage.getItem(`${BUSINESS_SETUP_KEY_PREFIX}${userId}`) === '1';
  } catch {
    return false;
  }
}

export function markBusinessSetupComplete(userId: string): void {
  try {
    localStorage.setItem(`${BUSINESS_SETUP_KEY_PREFIX}${userId}`, '1');
  } catch { /* privacy mode */ }
}

export function clearBusinessSetup(userId: string): void {
  try {
    localStorage.removeItem(`${BUSINESS_SETUP_KEY_PREFIX}${userId}`);
  } catch { /* privacy mode */ }
}

export function clearAllOnboardingFlags(userId: string): void {
  clearAccountTypeOnboarding(userId);
  clearBusinessSetup(userId);
  clearChosenAccountType(userId);
}
