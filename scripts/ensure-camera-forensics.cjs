/**
 * Compact camera-sensor sidecar on dna_records.
 * Prisma schema already has DnaRecord.cameraForensics, but production
 * start:prod uses ensure-* scripts instead of `prisma migrate deploy`,
 * so this column never arrived and crawler/monitor Prisma reads fail.
 *
 * ADDITIVE AND IDEMPOTENT. Safe on every boot.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-camera-forensics]', ...a);

(async () => {
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "dna_records" ADD COLUMN IF NOT EXISTS "cameraForensics" JSONB`,
    );
    log('ok: dna_records.cameraForensics');
  } catch (err) {
    log('WARNING — could not add cameraForensics:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
