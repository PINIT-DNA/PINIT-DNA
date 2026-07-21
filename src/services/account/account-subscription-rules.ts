/**
 * Account type × subscription plan state machine.
 * Single source of truth — enforced on backend, mirrored on frontend for UX.
 */

import { AppError } from '../../api/middleware/error.middleware';
import { AccountType } from './constants/account-type';
import { PlanCode } from '../subscription/constants/plans';

export type { AccountType };
export type SubscriptionPlanCode = PlanCode;

const ALLOWED: Record<'INDIVIDUAL' | 'BUSINESS', readonly PlanCode[]> = {
  INDIVIDUAL: [PlanCode.FREE, PlanCode.PRO],
  BUSINESS: [PlanCode.FREE, PlanCode.PRO, PlanCode.ENTERPRISE],
};

export function allowedPlansForAccountType(
  accountType: 'INDIVIDUAL' | 'BUSINESS',
): readonly PlanCode[] {
  return ALLOWED[accountType === AccountType.BUSINESS ? 'BUSINESS' : 'INDIVIDUAL'];
}

export function isValidAccountPlanCombination(
  accountType: 'INDIVIDUAL' | 'BUSINESS',
  planCode: PlanCode,
): boolean {
  return allowedPlansForAccountType(accountType).includes(planCode);
}

export class InvalidAccountPlanCombinationError extends AppError {
  constructor(
    public readonly accountType: 'INDIVIDUAL' | 'BUSINESS',
    public readonly planCode: PlanCode,
  ) {
    super(
      409,
      accountType === 'INDIVIDUAL' && planCode === PlanCode.ENTERPRISE
        ? 'Enterprise subscription requires a Business account. Please convert this account to Business or contact support.'
        : `Plan ${planCode} is not available for ${accountType} accounts.`,
    );
    this.name = 'InvalidAccountPlanCombinationError';
  }
}

/** Throws if account type and plan code are not an allowed pair. */
export function assertValidAccountPlanCombination(
  accountType: 'INDIVIDUAL' | 'BUSINESS',
  planCode: PlanCode,
): void {
  if (!isValidAccountPlanCombination(accountType, planCode)) {
    throw new InvalidAccountPlanCombinationError(accountType, planCode);
  }
}

/** Block account-type changes that would create an invalid pair with the active plan. */
export function assertAccountTypeChangeAllowed(
  targetAccountType: 'INDIVIDUAL' | 'BUSINESS',
  currentPlanCode: PlanCode,
): void {
  if (!isValidAccountPlanCombination(targetAccountType, currentPlanCode)) {
    throw new InvalidAccountPlanCombinationError(targetAccountType, currentPlanCode);
  }
}
