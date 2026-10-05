-- Login lighting / match telemetry (no embeddings)
ALTER TABLE "login_history" ADD COLUMN IF NOT EXISTS "ambientBrightness" INTEGER;
ALTER TABLE "login_history" ADD COLUMN IF NOT EXISTS "lightingStatus" TEXT;
ALTER TABLE "login_history" ADD COLUMN IF NOT EXISTS "euclideanDistance" DOUBLE PRECISION;
ALTER TABLE "login_history" ADD COLUMN IF NOT EXISTS "executionTimeMs" DOUBLE PRECISION;

-- Encrypted FaceTemplate.templateCipher is the only stored face template
ALTER TABLE "users" DROP COLUMN IF EXISTS "faceEmbedding";
