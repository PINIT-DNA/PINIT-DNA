/**
 * Lookup indexes for the Protect duplicate check and Layer 8.
 * Without them every new upload scans all dna_records / crypto_layers rows.
 *
 * ADDITIVE AND IDEMPOTENT. Safe on every deploy.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-protect-indexes]', ...a);

const INDEXES = [
  ['dna_records_sha256Hash_idx', 'dna_records', '"sha256Hash"'],
  ['crypto_layers_sha256Hash_idx', 'crypto_layers', '"sha256Hash"'],
  ['crypto_layers_normalizedHash_idx', 'crypto_layers', '"normalizedHash"'],
  ['local_feature_indexes_createdAt_idx', 'local_feature_indexes', '"createdAt"'],
  ['perceptual_layers_createdAt_idx', 'perceptual_layers', '"createdAt"'],
];

(async () => {
  try {
    for (const [name, table, cols] of INDEXES) {
      try {
        await prisma.$executeRawUnsafe(
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ON "${table}" (${cols})`,
        );
      } catch {
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${name}" ON "${table}" (${cols})`);
      }
      log(`ok: ${name}`);
    }
  } catch (err) {
    log('WARNING — could not create index:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
