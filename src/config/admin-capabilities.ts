/**
 * Master Admin — RBAC capability map (Phase 2).
 *
 * The five UserRole values are grouped into read-access "domains" that
 * mirror the admin console's sidebar sections. A role's presence in a
 * domain's list grants read access to every route tagged with that domain.
 *
 * Destructive actions (role changes, activate/suspend) are NOT covered by
 * this map — they stay gated behind `requireSuperAdmin`, which additionally
 * requires the hardcoded platform-owner shortId allowlist. That gate is
 * intentionally stricter than any role alone, including SUPER_ADMIN.
 */
import type { UserRole } from '@prisma/client';

export type AdminDomain =
  | 'overview'
  | 'identity'
  | 'assets'
  | 'forensics'
  | 'operations'
  | 'intelligence'
  | 'system'
  | 'commerce';

export const ADMIN_DOMAINS: { key: AdminDomain; label: string; description: string }[] = [
  { key: 'overview', label: 'Overview', description: 'Executive dashboard, system health, recent activity' },
  { key: 'identity', label: 'Identity', description: 'Users, organizations, institutions (read)' },
  { key: 'assets', label: 'Assets', description: 'Vault, files, DNA engine, certificates' },
  { key: 'forensics', label: 'Forensics', description: 'Investigations and access tracking' },
  { key: 'operations', label: 'Operations', description: 'Monitoring and threat surfaces' },
  { key: 'intelligence', label: 'Intelligence', description: 'Analytics, audit logs, admin audit trail' },
  { key: 'system', label: 'System', description: 'Security center, settings, developer console' },
  { key: 'commerce', label: 'Commerce', description: 'Marketplace, billing, subscriptions, credits' },
];

const ROLE_CAPABILITIES: Record<UserRole, AdminDomain[]> = {
  SUPER_ADMIN: ['overview', 'identity', 'assets', 'forensics', 'operations', 'intelligence', 'system', 'commerce'],
  ADMIN: ['overview', 'identity', 'assets', 'forensics', 'operations', 'intelligence', 'commerce'],
  ANALYST: ['overview', 'assets', 'intelligence'],
  AUDITOR: ['overview', 'identity', 'forensics', 'intelligence'],
  USER: [],
};

export function getCapabilitiesForRole(role: UserRole): AdminDomain[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

export function getRoleCapabilityMatrix(): Record<UserRole, AdminDomain[]> {
  return ROLE_CAPABILITIES;
}

export function hasCapability(role: UserRole, domain: AdminDomain): boolean {
  return getCapabilitiesForRole(role).includes(domain);
}
