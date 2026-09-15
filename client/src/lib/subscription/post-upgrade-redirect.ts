import type { PlanCode } from '../../hooks/useSubscription';
import type { AccountType } from '../account-type';

export const BUSINESS_DASHBOARD_PATH = '/business';

/** After login: Personal Hub home. Workspace shell is resolved separately (Personal first). */
export function resolveLoginHomePath(): string {
  return '/';
}

/** Home after account-type onboarding / paid upgrade — not the post-login default. */
export function resolveDefaultHomePath(accountType: AccountType): string {
  if (accountType === 'BUSINESS') {
    return BUSINESS_DASHBOARD_PATH;
  }
  return '/';
}

/** After paid upgrade — stay on the same account-type home; Enterprise unlocks modules in-place. */
export function resolvePostUpgradePath(
  _planCode: PlanCode,
  returnTo?: string,
  accountType?: AccountType,
): string {
  if (returnTo && returnTo !== '/upgrade' && !returnTo.startsWith('/subscription')) {
    return returnTo;
  }
  return resolveDefaultHomePath(accountType ?? 'INDIVIDUAL');
}

export { SUBSCRIPTION_DEFAULTS } from './defaults';
