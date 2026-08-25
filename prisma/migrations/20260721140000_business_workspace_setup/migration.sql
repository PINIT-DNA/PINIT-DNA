-- Business workspace onboarding (organization profile + default workspace)

DO $$ BEGIN
  CREATE TYPE "OrganizationIndustry" AS ENUM (
    'MEDIA',
    'LEGAL',
    'EDUCATION',
    'TECHNOLOGY',
    'HEALTHCARE',
    'AGENCY',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrganizationSize" AS ENUM (
    'SOLO',
    'SMALL',
    'MEDIUM',
    'LARGE',
    'XLARGE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "organizationIndustry" "OrganizationIndustry",
  ADD COLUMN IF NOT EXISTS "organizationSize" "OrganizationSize",
  ADD COLUMN IF NOT EXISTS "workspaceName" TEXT,
  ADD COLUMN IF NOT EXISTS "businessSetupCompletedAt" TIMESTAMP(3);

-- Existing business users with an organization name are treated as already set up
UPDATE "users"
SET "businessSetupCompletedAt" = NOW(),
    "workspaceName" = COALESCE("workspaceName", 'Main Workspace')
WHERE "accountType" = 'BUSINESS'
  AND "organization" IS NOT NULL
  AND TRIM("organization") <> ''
  AND "businessSetupCompletedAt" IS NULL;
