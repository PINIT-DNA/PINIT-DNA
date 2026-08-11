/**
 * Role model. Kept dependency-free so both the edge middleware and server
 * components can import it.
 *
 *   EDITOR  — landing-page content only.
 *   ADMIN   — content, the demo/newsletter inbox, and site settings.
 *   OWNER   — everything, plus user management and the audit log.
 */
export const ROLES = ['EDITOR', 'ADMIN', 'OWNER'] as const;

export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { EDITOR: 1, ADMIN: 2, OWNER: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** True when `role` is at least as privileged as `required`. */
export function atLeast(role: string | null | undefined, required: Role): boolean {
  if (!isRole(role)) return false;
  return RANK[role] >= RANK[required];
}

export const ROLE_LABELS: Record<Role, string> = {
  EDITOR: 'Editor',
  ADMIN: 'Admin',
  OWNER: 'Owner',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  EDITOR: 'Can edit landing-page content.',
  ADMIN: 'Content, inbox, and site settings.',
  OWNER: 'Full control, including users and the audit log.',
};
