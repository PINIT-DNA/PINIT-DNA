import type { AccountType } from './account-type';

const KEY = 'pinit_pre_register_account_type';

export function setPreRegisterAccountType(type: AccountType): void {
  try {
    sessionStorage.setItem(KEY, type);
  } catch { /* privacy mode */ }
}

export function getPreRegisterAccountType(): AccountType | null {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value === 'BUSINESS' || value === 'INDIVIDUAL') return value;
    return null;
  } catch {
    return null;
  }
}

export function clearPreRegisterAccountType(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch { /* privacy mode */ }
}
