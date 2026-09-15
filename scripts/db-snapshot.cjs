/**
 * Snapshot the small, high-value tables to a local JSON file before schema work.
 *
 * READ-ONLY. Runs SELECTs and nothing else.
 *
 * Output goes to scripts/backups/, which is gitignored — the file contains real
 * user data (DNA records, vault records, certificates) and must never be
 * committed or shared.
 *
 * This is a safety net for reviewing what changed, not a disaster-recovery
 * backup: it does not capture encrypted vault file bytes, which live in
 * Supabase Storage. For real backups enable PITR in Supabase.
 *
 * Usage: node scripts/db-snapshot.cjs [reason]
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const log = (...a) => console.log('[db-snapshot]', ...a);

const TABLES = [
  'assets',
  'asset_versions',
  'campaigns',
  'clients',
  'campaign_members',
  'share_links',
  'dna_records',
  'vault_records',
  'certificates',
];

(async () => {
  const reason = process.argv[2] || 'manual';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });

  const out = { takenAt: new Date().toISOString(), reason };
  const counts = [];

  for (const table of TABLES) {
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
      out[table] = rows;
      counts.push(`${table}=${rows.length}`);
    } catch (err) {
      // A table that does not exist yet is not an error — it just predates or
      // postdates this snapshot. Record it so the file is self-describing.
      out[table] = { absent: true, reason: err.message };
      counts.push(`${table}=absent`);
    }
  }

  const file = path.join(dir, `snapshot-${reason}-${stamp}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      out,
      (_k, v) => (typeof v === 'bigint' ? Number(v)
        : Buffer.isBuffer(v) ? `<buffer:${v.length}b>` : v),
      1,
    ),
  );

  log(`wrote ${path.relative(process.cwd(), file)}`);
  log(counts.join('  '));
  await prisma.$disconnect();
})().catch(async (err) => {
  log('FAILED —', err.message);
  await prisma.$disconnect();
  process.exit(1);
});
