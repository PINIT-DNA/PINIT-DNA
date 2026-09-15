-- Additive: multi-platform links per Asset (creator provenance)
-- Does NOT alter existing ProtectedPost / Asset columns.

CREATE TABLE "asset_platform_links" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "assetId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "platformPostId" TEXT,
  "uploadMethod" TEXT,
  "isOriginal" BOOLEAN NOT NULL DEFAULT false,
  "role" TEXT NOT NULL DEFAULT 'published',
  "metadata" JSONB,
  CONSTRAINT "asset_platform_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_platform_links_assetId_platform_url_key"
  ON "asset_platform_links"("assetId", "platform", "url");
CREATE INDEX "asset_platform_links_assetId_createdAt_idx"
  ON "asset_platform_links"("assetId", "createdAt");
CREATE INDEX "asset_platform_links_platform_idx"
  ON "asset_platform_links"("platform");
CREATE INDEX "asset_platform_links_url_idx"
  ON "asset_platform_links"("url");

ALTER TABLE "asset_platform_links"
  ADD CONSTRAINT "asset_platform_links_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
