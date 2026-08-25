-- Platform events (canonical event log) + notification extensions

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "deepLink" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "aggregateCount" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "notifications_userId_dedupeKey_idx" ON "notifications"("userId", "dedupeKey");

CREATE TABLE IF NOT EXISTS "platform_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deepLink" TEXT,
    "dedupeKey" TEXT,
    "payload" JSONB,

    CONSTRAINT "platform_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "platform_events_ownerUserId_createdAt_idx" ON "platform_events"("ownerUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "platform_events_name_createdAt_idx" ON "platform_events"("name", "createdAt");
CREATE INDEX IF NOT EXISTS "platform_events_dedupeKey_idx" ON "platform_events"("dedupeKey");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_events_ownerUserId_fkey'
  ) THEN
    ALTER TABLE "platform_events"
      ADD CONSTRAINT "platform_events_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
