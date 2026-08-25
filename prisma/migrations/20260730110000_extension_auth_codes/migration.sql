-- Extension OAuth one-time codes (Hub → PinIT Hub extension)
CREATE TABLE IF NOT EXISTS "extension_auth_codes" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "code" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "extensionId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "extension_auth_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "extension_auth_codes_code_key"
  ON "extension_auth_codes"("code");

CREATE INDEX IF NOT EXISTS "extension_auth_codes_code_idx"
  ON "extension_auth_codes"("code");

CREATE INDEX IF NOT EXISTS "extension_auth_codes_expiresAt_idx"
  ON "extension_auth_codes"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'extension_auth_codes_ownerUserId_fkey'
  ) THEN
    ALTER TABLE "extension_auth_codes"
      ADD CONSTRAINT "extension_auth_codes_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
