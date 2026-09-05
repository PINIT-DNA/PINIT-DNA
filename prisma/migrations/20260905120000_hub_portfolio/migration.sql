-- Phase 1: Hub-owned portfolio. Additive only. Does not drop Exchange tables.

CREATE TABLE IF NOT EXISTS "portfolios" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'unlisted',
    "theme" TEXT NOT NULL DEFAULT 'editorial',
    "template" TEXT NOT NULL DEFAULT 'individual',
    "publishState" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "publishedVersion" INTEGER NOT NULL DEFAULT 0,
    "publishedSnapshot" JSONB,
    "featuredListingIds" JSONB,
    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "portfolios_userId_key" ON "portfolios"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "portfolios_slug_key" ON "portfolios"("slug");
CREATE INDEX IF NOT EXISTS "portfolios_publishState_visibility_idx" ON "portfolios"("publishState", "visibility");

DO $$ BEGIN
  ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_profiles" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "about" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "coverUrl" TEXT NOT NULL DEFAULT '',
    "heroImageRef" TEXT NOT NULL DEFAULT '',
    "quote" TEXT NOT NULL DEFAULT '',
    "cvStorageKey" TEXT,
    "website" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "contactNote" TEXT NOT NULL DEFAULT '',
    "availableFor" JSONB,
    "languages" JSONB,
    "clientCount" INTEGER NOT NULL DEFAULT 0,
    "specializations" JSONB,
    "sectionVisibility" JSONB,
    CONSTRAINT "portfolio_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_profiles_portfolioId_key" ON "portfolio_profiles"("portfolioId");

DO $$ BEGIN
  ALTER TABLE "portfolio_profiles" ADD CONSTRAINT "portfolio_profiles_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_projects" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "client" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "services" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "coverMediaId" TEXT,
    CONSTRAINT "portfolio_projects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_projects_portfolioId_slug_key" ON "portfolio_projects"("portfolioId", "slug");
CREATE INDEX IF NOT EXISTS "portfolio_projects_portfolioId_sortOrder_idx" ON "portfolio_projects"("portfolioId", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "portfolio_projects" ADD CONSTRAINT "portfolio_projects_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_project_media" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'IMAGE',
    "title" TEXT NOT NULL DEFAULT '',
    "altText" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "vaultId" TEXT,
    "assetId" TEXT,
    "externalUrl" TEXT,
    "storageKey" TEXT,
    CONSTRAINT "portfolio_project_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "portfolio_project_media_projectId_sortOrder_idx" ON "portfolio_project_media"("projectId", "sortOrder");
CREATE INDEX IF NOT EXISTS "portfolio_project_media_vaultId_idx" ON "portfolio_project_media"("vaultId");
CREATE INDEX IF NOT EXISTS "portfolio_project_media_assetId_idx" ON "portfolio_project_media"("assetId");

DO $$ BEGIN
  ALTER TABLE "portfolio_project_media" ADD CONSTRAINT "portfolio_project_media_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "portfolio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_collections" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "coverUrl" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "portfolio_collections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_collections_portfolioId_slug_key" ON "portfolio_collections"("portfolioId", "slug");
CREATE INDEX IF NOT EXISTS "portfolio_collections_portfolioId_sortOrder_idx" ON "portfolio_collections"("portfolioId", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "portfolio_collections" ADD CONSTRAINT "portfolio_collections_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_collection_items" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "projectId" TEXT,
    "assetId" TEXT,
    "vaultId" TEXT,
    CONSTRAINT "portfolio_collection_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "portfolio_collection_items_collectionId_sortOrder_idx" ON "portfolio_collection_items"("collectionId", "sortOrder");

DO $$ BEGIN
  ALTER TABLE "portfolio_collection_items" ADD CONSTRAINT "portfolio_collection_items_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "portfolio_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_services" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "portfolio_services_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "portfolio_services_portfolioId_sortOrder_idx" ON "portfolio_services"("portfolioId", "sortOrder");
DO $$ BEGIN
  ALTER TABLE "portfolio_services" ADD CONSTRAINT "portfolio_services_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_skills" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "portfolio_skills_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "portfolio_skills_portfolioId_sortOrder_idx" ON "portfolio_skills"("portfolioId", "sortOrder");
DO $$ BEGIN
  ALTER TABLE "portfolio_skills" ADD CONSTRAINT "portfolio_skills_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_experience" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL DEFAULT '',
    "endDate" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "portfolio_experience_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "portfolio_experience_portfolioId_sortOrder_idx" ON "portfolio_experience"("portfolioId", "sortOrder");
DO $$ BEGIN
  ALTER TABLE "portfolio_experience" ADD CONSTRAINT "portfolio_experience_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_awards" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "organization" TEXT NOT NULL DEFAULT '',
    "year" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "imageKey" TEXT,
    "documentKey" TEXT,
    "externalUrl" TEXT NOT NULL DEFAULT '',
    "relatedProjectId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "portfolio_awards_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "portfolio_awards_portfolioId_sortOrder_idx" ON "portfolio_awards"("portfolioId", "sortOrder");
DO $$ BEGIN
  ALTER TABLE "portfolio_awards" ADD CONSTRAINT "portfolio_awards_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_certificates" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT NOT NULL DEFAULT '',
    "recipient" TEXT NOT NULL DEFAULT '',
    "issuedOn" TEXT NOT NULL DEFAULT '',
    "expiresOn" TEXT NOT NULL DEFAULT '',
    "credentialId" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "imageKey" TEXT,
    "documentKey" TEXT,
    "verificationUrl" TEXT NOT NULL DEFAULT '',
    "relatedSkill" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "portfolio_certificates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "portfolio_certificates_portfolioId_sortOrder_idx" ON "portfolio_certificates"("portfolioId", "sortOrder");
DO $$ BEGIN
  ALTER TABLE "portfolio_certificates" ADD CONSTRAINT "portfolio_certificates_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_collaborations" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'collaboration',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "year" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "portfolio_collaborations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "portfolio_collaborations_portfolioId_sortOrder_idx" ON "portfolio_collaborations"("portfolioId", "sortOrder");
DO $$ BEGIN
  ALTER TABLE "portfolio_collaborations" ADD CONSTRAINT "portfolio_collaborations_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portfolio_social_links" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "portfolio_social_links_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "portfolio_social_links_portfolioId_sortOrder_idx" ON "portfolio_social_links"("portfolioId", "sortOrder");
DO $$ BEGIN
  ALTER TABLE "portfolio_social_links" ADD CONSTRAINT "portfolio_social_links_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
