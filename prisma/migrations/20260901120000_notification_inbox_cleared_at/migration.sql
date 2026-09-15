-- Inbox clear watermark: hide from bell/badge without deleting notification rows.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notificationInboxClearedAt" TIMESTAMP(3);
