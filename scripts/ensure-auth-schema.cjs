/**
 * Auth / login columns that exist in prisma/schema.prisma but may be missing
 * on production because start:prod uses ensure-* instead of migrate deploy.
 *
 * ADDITIVE AND IDEMPOTENT. Safe on every boot.
 * Does not drop data except the unused users.faceEmbedding column (templates
 * live in FaceTemplate.templateCipher).
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-auth-schema]', ...a);

const STMTS = [
  `DO $$ BEGIN
     CREATE TYPE "WorkspaceShell" AS ENUM ('PERSONAL', 'BUSINESS');
   EXCEPTION
     WHEN duplicate_object THEN NULL;
   END $$`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastActiveShell" "WorkspaceShell" NOT NULL DEFAULT 'PERSONAL'`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address" TEXT`,
  `ALTER TABLE "login_history" ADD COLUMN IF NOT EXISTS "ambientBrightness" INTEGER`,
  `ALTER TABLE "login_history" ADD COLUMN IF NOT EXISTS "lightingStatus" TEXT`,
  `ALTER TABLE "login_history" ADD COLUMN IF NOT EXISTS "euclideanDistance" DOUBLE PRECISION`,
  `ALTER TABLE "login_history" ADD COLUMN IF NOT EXISTS "executionTimeMs" DOUBLE PRECISION`,
  `ALTER TABLE "users" DROP COLUMN IF EXISTS "faceEmbedding"`,
];

(async () => {
  try {
    for (const sql of STMTS) {
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch (err) {
        log('skip', err.message);
      }
    }
    log('ok: lastActiveShell + login_history lighting columns');
  } catch (err) {
    log('WARNING — could not ensure auth schema:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
