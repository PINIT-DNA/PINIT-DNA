/**
 * Campaign job titles — mirror of src/services/organization/constants/campaign-roles.ts.
 * Kept client-side so the UI does not import server modules. IDs must stay in sync.
 *
 * Not the same as organization/business roles (OWNER · MANAGER · MEMBER …).
 */
export const CAMPAIGN_ROLES = [
  { id: 'OWNER',           label: 'Campaign owner' },
  { id: 'PROJECT_MANAGER', label: 'Project manager' },
  { id: 'CONTRIBUTOR',     label: 'Contributor' },
  { id: 'REVIEWER',        label: 'Reviewer' },
  { id: 'DESIGNER',        label: 'Designer' },
  { id: 'DEVELOPER',       label: 'Developer' },
] as const;

export type CampaignRoleId = (typeof CAMPAIGN_ROLES)[number]['id'];

export function isCampaignRole(v: string): v is CampaignRoleId {
  return CAMPAIGN_ROLES.some((r) => r.id === v);
}

export function campaignRoleLabel(id: string | null | undefined): string {
  if (!id) return 'Team member';
  return CAMPAIGN_ROLES.find((r) => r.id === id)?.label
    ?? id.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
