-- Encrypted copy of the details read from a verified government ID.

ALTER TABLE "government_id_records" ADD COLUMN IF NOT EXISTS "identityDataCipher" BYTEA;
