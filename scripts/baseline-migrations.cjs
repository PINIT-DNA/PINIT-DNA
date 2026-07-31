/**
 * Baseline Prisma migrations on an existing Supabase / production database.
 *
 * Use when:
 *   - prisma migrate deploy → P3005 (schema not empty, no migration history)
 *   - prisma migrate dev    → P3006 (shadow DB cannot replay incomplete migration chain)
 *
 * This script does NOT drop tables, reset the database, or delete data.
 *
 * Steps:
 *   1. Apply idempotent schema bootstraps (tables/columns that may be missing)
 *   2. Mark every folder in prisma/migrations as already applied (resolve --applied)
 *
 * After running once, `npm run db:migrate:prod` applies only future migrations.
 *
 * Requires DIRECT_URL (session pooler, port 5432) — not the transaction pooler.
 *
 * Usage: npm run db:baseline
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

require('dotenv').config({ path: path.join(root, '.env') });
require('./normalize-db-env.cjs');

if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
  console.error('[baseline] Set DIRECT_URL (and DATABASE_URL) in .env before baselining.');
  process.exit(1);
}

if (!process.env.DIRECT_URL) {
  console.warn('[baseline] DIRECT_URL not set — using DATABASE_URL. Prefer session pooler (port 5432) for migrate resolve.');
}

const ensureScripts = [
  'scripts/ensure-provenance-table.cjs',
  'scripts/ensure-platform-events.cjs',
];

console.log('[baseline] Applying idempotent schema bootstraps…');
for (const script of ensureScripts) {
  execSync(`node ${script}`, { stdio: 'inherit', cwd: root });
}

const migrationsDir = path.join(root, 'prisma', 'migrations');
const names = fs
  .readdirSync(migrationsDir)
  .filter((n) => fs.statSync(path.join(migrationsDir, n)).isDirectory())
  .sort();

console.log('[baseline] Marking migrations as applied (no SQL replay):', names.join(', '));

for (const name of names) {
  try {
    execSync(`npx prisma migrate resolve --applied "${name}"`, {
      stdio: 'inherit',
      cwd: root,
      env: process.env,
    });
    console.log(`[baseline] ✓ ${name}`);
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('already recorded as applied')) {
      console.log(`[baseline] ✓ ${name} (already applied)`);
    } else {
      console.warn(`[baseline] resolve ${name}:`, msg);
    }
  }
}

console.log('');
console.log('[baseline] Done.');
console.log('  • Production schema bootstraps applied (idempotent).');
console.log('  • Migration history recorded in _prisma_migrations.');
console.log('  • Future changes: add prisma/migrations/<timestamp>_<name>/ then npm run db:migrate:prod');
console.log('  • Do NOT use `prisma migrate dev` against this Supabase DB — use `npx prisma db push` locally.');
