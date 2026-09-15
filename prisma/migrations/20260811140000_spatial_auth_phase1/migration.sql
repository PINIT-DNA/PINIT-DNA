-- Phase 1 Spatial Auth — one compact package per DNA record (no per-pixel rows)

CREATE TABLE "spatial_auth_packages" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dnaRecordId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "orientationPolicy" TEXT NOT NULL DEFAULT 'file-pixel-order-v1',
    "globalDnaRef" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "primaryScale" INTEGER NOT NULL,
    "scales" INTEGER[],
    "merkleRoot" CHAR(64) NOT NULL,
    "rootMac" CHAR(64) NOT NULL,
    "blockBlob" BYTEA NOT NULL,

    CONSTRAINT "spatial_auth_packages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "spatial_auth_packages_dnaRecordId_key" ON "spatial_auth_packages"("dnaRecordId");
CREATE INDEX "spatial_auth_packages_ownerUserId_idx" ON "spatial_auth_packages"("ownerUserId");

ALTER TABLE "spatial_auth_packages" ADD CONSTRAINT "spatial_auth_packages_dnaRecordId_fkey" FOREIGN KEY ("dnaRecordId") REFERENCES "dna_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "spatial_auth_packages" ADD CONSTRAINT "spatial_auth_packages_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
