/**
 * Clear stale Asset.vaultId pointers left behind by deleted vault records.
 *
 * `Asset.vaultId` is a plain TEXT column, not a foreign key, so deleting a
 * vault row historically left the pointer behind. vault.service.delete() now
 * clears it in the same transaction; this repairs the rows that predate that
 * fix, and stays in the boot chain as a self-heal for anything that removes a
 * vault row outside the service (a cascade from DnaRecord, a manual SQL fix).
 *
 * ADDITIVE AND IDEMPOTENT. Safe to run on every boot.
 *   - Sets a dangling "vaultId" to NULL. Nothing else on the asset is touched.
 *   - DELETES NOTHING: no asset, no vault, no DNA record, no certificate.
 *   - CREATES NOTHING: no vault row is invented to satisfy a pointer.
 *   - Applies no DDL — the schema is unchanged.
 *
 * The asset keeps its identity either way: dnaId, certificateId, contentHash,
 * timeline and every relation survive. Only the pointer to a row that no
 * longer exists goes away.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const log = (...a) => console.log('[ensure-asset-vault-links]', ...a);

const COUNT_DANGLING = `
  SELECT COUNT(*)::int n
    FROM "assets" a
   WHERE a."vaultId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "vault_records" v WHERE v."id" = a."vaultId")`;

const CLEAR_DANGLING = `
  UPDATE "assets" a SET "vaultId" = NULL
   WHERE a."vaultId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "vault_records" v WHERE v."id" = a."vaultId")`;

async function main() {
  const [{ n: dangling }] = await prisma.$queryRawUnsafe(COUNT_DANGLING);
  if (dangling === 0) {
    log('no dangling Asset.vaultId references');
    return;
  }

  // Nulling every pointer at once is the correct outcome only if the vault
  // table is genuinely populated. An empty one means we are pointed at the
  // wrong database, and clearing on that basis would be destructive.
  const [{ n: vaults }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int n FROM "vault_records"`,
  );
  if (vaults === 0) {
    log(`ABORT: ${dangling} dangling reference(s) but the vault table is empty.`);
    log('Refusing to clear — this looks like the wrong database, not deleted vaults.');
    return;
  }

  const cleared = await prisma.$executeRawUnsafe(CLEAR_DANGLING);
  log(`${cleared} stale Asset.vaultId reference(s) cleared (assets kept intact)`);
}

main()
  .catch((err) => {
    // Never block boot on a cleanup failure — the stale pointer is survivable.
    console.warn('[ensure-asset-vault-links] skipped:', err.message || err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
