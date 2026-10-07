-- Social and professional links shown on the Profile page (and, if the owner allows, the public portfolio).

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "socialLinks" JSONB;
