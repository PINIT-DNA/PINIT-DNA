-- Business enterprise foundation: org profile, teams, departments, audit, API keys, org-scoped assets

CREATE TYPE "OrganizationMemberRole" AS ENUM ('OWNER', 'MANAGER', 'INVESTIGATOR', 'MEMBER', 'VIEWER');
CREATE TYPE "OrganizationInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "organizationSize" "OrganizationSize";
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "businessType" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "website" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "registrationNumber" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "gst" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "addressLine1" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "addressLine2" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "supportEmail" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "supportPhone" TEXT;

ALTER TABLE "dna_records" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "dna_records" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "dna_records" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;

CREATE TABLE IF NOT EXISTS "departments" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "organizationId" TEXT NOT NULL,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "organization_members" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganizationMemberRole" NOT NULL DEFAULT 'MEMBER',
    "departmentId" TEXT,
    "invitedByUserId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "organization_invites" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT,
    "inviteeShortId" TEXT,
    "role" "OrganizationMemberRole" NOT NULL DEFAULT 'MEMBER',
    "token" TEXT NOT NULL,
    "status" "OrganizationInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "organization_audit_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "title" TEXT NOT NULL,
    "detail" JSONB,
    CONSTRAINT "organization_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "organization_api_keys" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "organization_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "departments_organizationId_name_key" ON "departments"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "departments_organizationId_idx" ON "departments"("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_organizationId_userId_key" ON "organization_members"("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "organization_members_userId_idx" ON "organization_members"("userId");
CREATE INDEX IF NOT EXISTS "organization_members_organizationId_idx" ON "organization_members"("organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "organization_invites_token_key" ON "organization_invites"("token");
CREATE INDEX IF NOT EXISTS "organization_invites_organizationId_status_idx" ON "organization_invites"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "organization_invites_email_idx" ON "organization_invites"("email");
CREATE INDEX IF NOT EXISTS "organization_audit_logs_organizationId_createdAt_idx" ON "organization_audit_logs"("organizationId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "organization_api_keys_keyHash_key" ON "organization_api_keys"("keyHash");
CREATE INDEX IF NOT EXISTS "organization_api_keys_organizationId_idx" ON "organization_api_keys"("organizationId");
CREATE INDEX IF NOT EXISTS "dna_records_organizationId_idx" ON "dna_records"("organizationId");

ALTER TABLE "departments" ADD CONSTRAINT "departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_audit_logs" ADD CONSTRAINT "organization_audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_api_keys" ADD CONSTRAINT "organization_api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dna_records" ADD CONSTRAINT "dna_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dna_records" ADD CONSTRAINT "dna_records_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dna_records" ADD CONSTRAINT "dna_records_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
