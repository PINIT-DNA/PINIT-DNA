import type { AccountType } from './account-type';

const STORAGE_PREFIX = 'pinit_account_view:';

export type AccountViewMode = AccountType;

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function getAccountViewMode(
  userId: string | null | undefined,
  accountType: AccountType | null | undefined,
): AccountViewMode {
  const fallback: AccountViewMode = accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';
  if (!userId || typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (raw === 'INDIVIDUAL' || raw === 'BUSINESS') return raw;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function setAccountViewMode(userId: string, mode: AccountViewMode): void {
  try {
    localStorage.setItem(storageKey(userId), mode);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pinit-account-view', { detail: { userId, mode } }));
  }
}
