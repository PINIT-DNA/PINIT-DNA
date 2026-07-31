import type { AccountType } from './account-type';
import {
  needsAccountTypeOnboarding,
} from './account-onboarding';
import { resolveDefaultHomePath } from './subscription/post-upgrade-redirect';

export const ACCOUNT_TYPE_ONBOARDING_PATH = '/onboarding/account-type';

/** Where to send the user immediately after account type is saved. */
export function resolvePostAccountTypePath(accountType: AccountType): string {
  return resolveDefaultHomePath(accountType);
}

/** Whether the user can enter the main app (dashboard shell). */
export function isAppOnboardingComplete(user: { sub: string; accountType?: AccountType }): boolean {
  return !needsAccountTypeOnboarding(user);
}

/** Default home once fully onboarded. */
export function resolveFullyOnboardedHome(accountType: AccountType): string {
  return resolveDefaultHomePath(accountType);
}
