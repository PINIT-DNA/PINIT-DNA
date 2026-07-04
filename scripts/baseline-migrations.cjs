/**
 * Baseline Prisma migrations on a non-empty DB that was never managed by Migrate (P3005).
 * Marks all migration folders as already applied, then ensures provenance table exists.
 *
 * Usage: node scripts/baseline-migrations.cjs
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations');
const names = fs
  .readdirSync(migrationsDir)
  .filter((n) => fs.statSync(path.join(migrationsDir, n)).isDirectory())
  .sort();

console.log('[baseline] Marking migrations as applied:', names.join(', '));

for (const name of names) {
  try {
    execSync(`npx prisma migrate resolve --applied "${name}"`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
  } catch (err) {
    // Already applied is fine
    console.warn(`[baseline] resolve ${name}:`, err.message || err);
  }
}

console.log('[baseline] Ensuring provenance table…');
execSync('node scripts/ensure-provenance-table.cjs', {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

console.log('[baseline] Done. Future `prisma migrate deploy` should succeed for new migrations.');
