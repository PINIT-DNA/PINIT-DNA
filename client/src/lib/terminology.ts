/**
 * User-facing names for who is who. Do not rename API fields or Prisma models.
 *
 *   Team / team member     Organization member. Can be assigned to campaigns.
 *   Campaign team          Internal people already on a campaign.
 *   External creator       Campaign-scoped collaborator. Not an organization member.
 *                          Access is only through assigned assets / secure links.
 *   Client                 The client relationship (review, handover, reports).
 *   People                 Campaign umbrella tab: team + external creators + client.
 *   Recipients             People who opened a share link — not team or creators.
 */
export const TERMS = {
  team: 'Team',
  teamMember: 'Team member',
  teamMembers: 'Team members',
  campaignTeam: 'Campaign team',
  campaignPeople: 'People',
  externalCreator: 'External creator',
  externalCreators: 'External creators',
  client: 'Client',
  clients: 'Clients',
  recipients: 'Recipients',
} as const;
