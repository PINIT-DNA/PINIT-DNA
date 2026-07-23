-- Extended org profile fields for enterprise business profile UI

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "foundedYear" INTEGER;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "linkedIn" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "aboutDescription" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "services" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "shortId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_shortId_key" ON "workspaces"("shortId");
