-- Phase 3A — optional HKCA pixel auth fields on spatial_auth_packages (additive, nullable)

ALTER TABLE "spatial_auth_packages" ADD COLUMN "pixelAlgoVersion" TEXT;
ALTER TABLE "spatial_auth_packages" ADD COLUMN "pixelScheme" TEXT;
ALTER TABLE "spatial_auth_packages" ADD COLUMN "pixelKeyId" TEXT;
ALTER TABLE "spatial_auth_packages" ADD COLUMN "pixelCellSize" INTEGER;
ALTER TABLE "spatial_auth_packages" ADD COLUMN "pixelTagBytes" INTEGER;
ALTER TABLE "spatial_auth_packages" ADD COLUMN "pixelAuthBlob" BYTEA;
ALTER TABLE "spatial_auth_packages" ADD COLUMN "pixelAuthRoot" CHAR(64);
ALTER TABLE "spatial_auth_packages" ADD COLUMN "pixelRootMac" CHAR(64);
