export const OrganizationMemberRole = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  INVESTIGATOR: 'INVESTIGATOR',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
} as const;

export type OrganizationMemberRole =
  (typeof OrganizationMemberRole)[keyof typeof OrganizationMemberRole];

const ROLE_RANK: Record<OrganizationMemberRole, number> = {
  OWNER: 100,
  MANAGER: 80,
  INVESTIGATOR: 60,
  MEMBER: 40,
  VIEWER: 20,
};

export function roleMeetsMinimum(
  role: OrganizationMemberRole,
  minimum: OrganizationMemberRole,
): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const ORG_ROLE_LABELS: Record<OrganizationMemberRole, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  INVESTIGATOR: 'Investigator',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};
