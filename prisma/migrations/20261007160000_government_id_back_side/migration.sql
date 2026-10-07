-- Optional back side of a government ID (stored encrypted, like the front).

ALTER TABLE "government_id_records" ADD COLUMN IF NOT EXISTS "backStoragePath" TEXT;
ALTER TABLE "government_id_records" ADD COLUMN IF NOT EXISTS "backContentHash" TEXT;
ALTER TABLE "government_id_records" ADD COLUMN IF NOT EXISTS "backMimeType" TEXT;
ALTER TABLE "government_id_records" ADD COLUMN IF NOT EXISTS "backByteLength" INTEGER;
