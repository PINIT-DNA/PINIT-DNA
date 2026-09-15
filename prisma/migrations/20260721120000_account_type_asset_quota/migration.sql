-- Account type (independent from subscription plan)
CREATE TYPE "AccountType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accountType" "AccountType" NOT NULL DEFAULT 'INDIVIDUAL';

CREATE INDEX IF NOT EXISTS "users_accountType_idx" ON "users"("accountType");
