-- NOTIFICATIONS — class and entity reference.
--
-- ADDITIVE ONLY. Three nullable columns and two indexes on the EXISTING
-- notifications table. No second notification store.
--
--   notificationClass  ACTIVITY | NOTIFICATION | ALERT — decides where a row
--                      surfaces (timeline / bell / alerts). Null on rows that
--                      predate the distinction; those read as NOTIFICATION.
--   entityType/Id      what the row is about, so a click lands on the thing
--                      rather than on a list page.
--
-- DROPS / RENAMES / DELETES nothing and backfills nothing.

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "notificationClass" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "entityType" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "entityId" TEXT;

CREATE INDEX IF NOT EXISTS "notifications_userId_notificationClass_read_idx"
  ON "notifications"("userId", "notificationClass", "read");
CREATE INDEX IF NOT EXISTS "notifications_entityType_entityId_idx"
  ON "notifications"("entityType", "entityId");
