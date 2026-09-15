-- External-creator invitations reuse organization_invites.
-- campaignOnly=true: accept creates CampaignMember(isExternal) only — never OrganizationMember.

ALTER TABLE "organization_invites" ADD COLUMN IF NOT EXISTS "campaignOnly" BOOLEAN NOT NULL DEFAULT false;
