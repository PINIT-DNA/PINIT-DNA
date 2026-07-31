export const AccountType = {
  INDIVIDUAL: 'INDIVIDUAL',
  BUSINESS: 'BUSINESS',
} as const;

export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export function isBusinessAccount(type?: string | null): boolean {
  return type === AccountType.BUSINESS;
}

export function plansForAccountType(accountType: AccountType): Array<'FREE' | 'PRO' | 'ENTERPRISE'> {
  if (accountType === AccountType.BUSINESS) {
    return ['FREE', 'PRO', 'ENTERPRISE'];
  }
  return ['FREE', 'PRO'];
}
