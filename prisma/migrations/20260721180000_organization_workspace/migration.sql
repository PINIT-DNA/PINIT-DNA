-- Organization + Workspace foundation (Business Free — extensible for Enterprise)

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "shortId" TEXT NOT NULL,
  "name" TEXT,
  "industry" "OrganizationIndustry",
  "country" TEXT,
  "logoUrl" TEXT,
  "ownerUserId" TEXT NOT NULL,
  "setupCompletedAt" TIMESTAMP(3),
  "setupSkippedAt" TIMESTAMP(3),
  "welcomeDismissedAt" TIMESTAMP(3),
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "organizations_shortId_key" ON "organizations"("shortId");
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_ownerUserId_key" ON "organizations"("ownerUserId");
CREATE INDEX IF NOT EXISTS "organizations_ownerUserId_idx" ON "organizations"("ownerUserId");

CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Main Workspace',
  "isDefault" BOOLEAN NOT NULL DEFAULT true,
  "organizationId" TEXT NOT NULL,
  CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "workspaces_organizationId_idx" ON "workspaces"("organizationId");

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing business users into organizations (best-effort org PINIT IDs)
INSERT INTO "organizations" (
  "id", "updatedAt", "shortId", "name", "industry", "country",
  "ownerUserId", "setupCompletedAt", "setupSkippedAt"
)
SELECT
  gen_random_uuid()::text,
  NOW(),
  'PINIT-ORG-' || upper(substr(md5(u."id"::text), 1, 8)),
  u."organization",
  u."organizationIndustry",
  u."country",
  u."id",
  u."businessSetupCompletedAt",
  NULL::timestamp
FROM "users" u
WHERE u."accountType" = 'BUSINESS'
  AND NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."ownerUserId" = u."id");

INSERT INTO "workspaces" ("id", "updatedAt", "name", "isDefault", "organizationId")
SELECT
  gen_random_uuid()::text,
  NOW(),
  COALESCE(NULLIF(trim(u."workspaceName"), ''), 'Main Workspace'),
  true,
  o."id"
FROM "users" u
JOIN "organizations" o ON o."ownerUserId" = u."id"
WHERE u."accountType" = 'BUSINESS'
  AND NOT EXISTS (SELECT 1 FROM "workspaces" w WHERE w."organizationId" = o."id");
