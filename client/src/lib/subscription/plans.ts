import type { PlanCode } from '../../hooks/useSubscription';
import { SUBSCRIPTION_DEFAULTS } from './defaults';

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  description: string;
  storageLimitBytes: number | null;
  assetLimit?: number | null;
  teamMemberLimit?: number | null;
  workspaceLimit?: number | null;
  features: string[];
  priceInr: number;
  pricePaise: number;
  intervalLabel: string;
  periodDays: number;
}

export const FALLBACK_PLANS: PlanDefinition[] = [
  {
    code: 'FREE',
    name: 'Free',
    description: 'Full platform access — usage-limited protected assets',
    storageLimitBytes: SUBSCRIPTION_DEFAULTS.freeStorageBytes,
    assetLimit: SUBSCRIPTION_DEFAULTS.freeAssetLimit,
    teamMemberLimit: SUBSCRIPTION_DEFAULTS.businessFreeTeamLimit,
    workspaceLimit: SUBSCRIPTION_DEFAULTS.businessFreeWorkspaceLimit,
    features: ['FEATURE_DNA', 'FEATURE_VAULT', 'FEATURE_CERTIFICATES', 'FEATURE_DASHBOARD'],
    priceInr: 0,
    pricePaise: 0,
    intervalLabel: 'Forever',
    periodDays: 0,
  },
  {
    code: 'PRO',
    name: 'Pro',
    description: 'Unlimited protected assets + 100 GB storage',
    storageLimitBytes: 100 * 1024 * 1024 * 1024,
    assetLimit: null,
    teamMemberLimit: null,
    workspaceLimit: null,
    features: [
      'FEATURE_INVESTIGATION',
      'FEATURE_TRACKING',
      'FEATURE_SMART_SHARE',
      'FEATURE_ADVANCED_REPORTS',
    ],
    priceInr: 999,
    pricePaise: 99900,
    intervalLabel: 'per month',
    periodDays: 30,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Unlimited storage, teams, RBAC & API access',
    storageLimitBytes: null,
    assetLimit: null,
    teamMemberLimit: null,
    workspaceLimit: null,
    features: [
      'FEATURE_ENTERPRISE_TEAMS',
      'FEATURE_API_ACCESS',
      'FEATURE_AI_MONITORING',
      'FEATURE_BULK_UPLOAD',
    ],
    priceInr: 4999,
    pricePaise: 499900,
    intervalLabel: 'per month',
    periodDays: 30,
  },
];

export const PLAN_HIGHLIGHTS: Record<string, string[]> = {
  FREE: [
    'Full platform access',
    'Generate DNA & Vault',
    'Investigation & Access Intelligence',
    'Configurable asset quota',
    '2 GB storage',
  ],
  PRO: [
    'Unlimited protected assets',
    'Everything in Free',
    'Higher storage (100 GB)',
    'Team members (Business)',
    'Priority processing',
  ],
  ENTERPRISE: [
    'Everything in Pro',
    'Unlimited team members',
    'Multiple workspaces',
    'RBAC & audit logs',
    'API access',
  ],
};

export const COMPARISON_ROWS: Array<{
  label: string;
  free: string | boolean;
  pro: string | boolean;
  enterprise: string | boolean;
}> = [
  { label: 'Protected assets', free: String(SUBSCRIPTION_DEFAULTS.freeAssetLimit), pro: 'Unlimited', enterprise: 'Unlimited' },
  { label: 'Storage', free: '2 GB', pro: '100 GB', enterprise: 'Unlimited' },
  { label: 'DNA & Vault', free: true, pro: true, enterprise: true },
  { label: 'Certificates', free: true, pro: true, enterprise: true },
  { label: 'Investigation', free: true, pro: true, enterprise: true },
  { label: 'View in Timeline', free: true, pro: true, enterprise: true },
  { label: 'Monitoring & Crawler', free: true, pro: true, enterprise: true },
  { label: 'Access Intelligence', free: true, pro: true, enterprise: true },
  { label: 'Smart Share links', free: true, pro: true, enterprise: true },
  { label: 'Forensic Reports', free: true, pro: true, enterprise: true },
  { label: 'Teams & org workspace', free: `${SUBSCRIPTION_DEFAULTS.businessFreeTeamLimit} admin`, pro: 'Team members', enterprise: 'Unlimited' },
  { label: 'API access', free: false, pro: false, enterprise: true },
  { label: 'Priority support', free: false, pro: false, enterprise: true },
];

export function formatStorage(bytes: number | null): string {
  if (bytes == null) return 'Unlimited';
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb % 1 === 0 ? gb : gb.toFixed(1)} GB`;
}

export function getPlan(code: string | null, plans = FALLBACK_PLANS): PlanDefinition | undefined {
  if (!code) return undefined;
  return plans.find((p) => p.code === code);
}

export function isPaidPlan(code: string): boolean {
  return code === 'PRO' || code === 'ENTERPRISE';
}

export const UNLOCKED_FEATURES_BY_PLAN: Record<string, string[]> = {
  PRO: [
    'Unlimited protected assets',
    '100 GB storage',
    'Priority processing',
    'Advanced reports',
  ],
  ENTERPRISE: [
    'Everything in Pro',
    'Unlimited storage',
    'Organization & teams',
    'API keys & webhooks',
    'RBAC & audit logs',
    'Priority support',
  ],
};
