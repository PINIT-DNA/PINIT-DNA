/**
 * What someone does on a campaign.
 *
 * Deliberately separate from OrganizationMemberRole, which governs what a person
 * may do across the whole business (OWNER · MANAGER · INVESTIGATOR · MEMBER ·
 * VIEWER). This is a job title on one piece of work — a Developer on one
 * campaign can be a Reviewer on another without their business role changing.
 *
 * Authorization still comes from the organization role. This decides what the
 * person is here to do, not what they are permitted to do, and the two must not
 * be conflated: promoting someone to "Owner" of a campaign does not make them an
 * owner of the business.
 */
export const CAMPAIGN_ROLES = [
  { id: 'OWNER',           label: 'Campaign owner',  hint: 'Accountable for the work landing.' },
  { id: 'PROJECT_MANAGER', label: 'Project manager', hint: 'Runs the schedule and the client relationship.' },
  { id: 'CONTRIBUTOR',     label: 'Contributor',     hint: 'Makes the work.' },
  { id: 'REVIEWER',        label: 'Reviewer',        hint: 'Checks the work before it goes out.' },
  { id: 'DESIGNER',        label: 'Designer',        hint: 'Makes the work.' },
  { id: 'DEVELOPER',       label: 'Developer',       hint: 'Builds the work.' },
] as const;

export type CampaignRoleId = (typeof CAMPAIGN_ROLES)[number]['id'];

export function isCampaignRole(v: string): v is CampaignRoleId {
  return CAMPAIGN_ROLES.some((r) => r.id === v);
}

export function campaignRoleLabel(id: string | null | undefined): string {
  return CAMPAIGN_ROLES.find((r) => r.id === id)?.label ?? 'Team member';
}
