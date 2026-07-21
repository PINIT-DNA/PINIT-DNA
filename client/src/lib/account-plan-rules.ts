import type { AccountType } from './account-type';
import type { PlanCode } from '../hooks/useSubscription';

const ALLOWED: Record<AccountType, PlanCode[]> = {
  INDIVIDUAL: ['FREE', 'PRO'],
  BUSINESS: ['FREE', 'PRO', 'ENTERPRISE'],
};

export function allowedPlansForAccountType(accountType: AccountType): PlanCode[] {
  return ALLOWED[accountType];
}

export function isValidAccountPlanCombination(
  accountType: AccountType,
  planCode: PlanCode,
): boolean {
  return ALLOWED[accountType].includes(planCode);
}

export const ENTERPRISE_REQUIRES_BUSINESS_MSG =
  'Enterprise subscription requires a Business account. Please convert this account to Business or contact support.';
