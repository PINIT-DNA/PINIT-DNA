ALTER TABLE "share_links" ADD COLUMN IF NOT EXISTS "allowPrint" BOOLEAN NOT NULL DEFAULT false;
UPDATE "share_links" SET "allowPrint" = true WHERE "sourceContext" = 'exchange_license';
