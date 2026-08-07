/**
 * Wipe all application/test data while keeping schema + subscription plan catalog.
 *
 * Removes: users, face/biometric registrations, vault/DNA, shares, tracking,
 * monitoring, investigations, orgs, protected posts, assets, sessions, etc.
 *
 * Keeps: `plans` table rows, `_prisma_migrations`, table structure.
 * Also empties Supabase `vault-files` storage (encrypted blobs + org logos).
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/wipe-all-test-data.ts --confirm wipe-all-test-data
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const CONFIRM = 'wipe-all-test-data';
const KEEP_TABLES = new Set(['plans', '_prisma_migrations']);
const STORAGE_BUCKET = 'vault-files';

const prisma = new PrismaClient({
  datasources: {
    db: {
      // Prefer direct connection for TRUNCATE (avoids pgbouncer transaction-mode limits)
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

function assertConfirmed() {
  const args = process.argv.slice(2);
  const ok = args.includes('--confirm') && args.includes(CONFIRM);
  if (!ok) {
    console.error(`
REFUSED — this permanently deletes all users and test data.

Re-run with:
  npx ts-node --transpile-only scripts/wipe-all-test-data.ts --confirm ${CONFIRM}

Keeps: plans + schema
Deletes: users, biometrics, vault, DNA, shares, monitoring, investigations, orgs, storage blobs
`);
    process.exit(1);
  }
}

async function countRows(table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*)::bigint AS c FROM "${table}"`,
  );
  return Number(rows[0]?.c ?? 0);
}

async function listPublicTables(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return rows.map((r) => r.tablename);
}

async function wipeDatabase() {
  const tables = await listPublicTables();
  const wipe = tables.filter((t) => !KEEP_TABLES.has(t));

  console.log('\n=== BEFORE (sample counts) ===');
  for (const t of ['users', 'vault_records', 'dna_records', 'share_links', 'biometric_identities', 'face_templates', 'plans']) {
    if (tables.includes(t)) {
      console.log(`  ${t}: ${await countRows(t)}`);
    }
  }

  if (wipe.length === 0) {
    console.log('No tables to wipe.');
    return;
  }

  // Single TRUNCATE CASCADE — FK-safe, keeps plans/_prisma_migrations
  const quoted = wipe.map((t) => `"${t}"`).join(', ');
  console.log(`\nTruncating ${wipe.length} tables (keeping: ${[...KEEP_TABLES].join(', ')})…`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  console.log('Database truncate complete.');

  console.log('\n=== AFTER (sample counts) ===');
  for (const t of ['users', 'vault_records', 'dna_records', 'share_links', 'biometric_identities', 'face_templates', 'plans']) {
    if (tables.includes(t)) {
      console.log(`  ${t}: ${await countRows(t)}`);
    }
  }
}

async function emptyStorageFolder(client: ReturnType<typeof createClient>, folder = ''): Promise<number> {
  let removed = 0;
  let offset = 0;
  const limit = 1000;

  for (;;) {
    const { data, error } = await client.storage.from(STORAGE_BUCKET).list(folder, {
      limit,
      offset,
    });
    if (error) {
      console.warn(`  Storage list failed (${folder || '/'}): ${error.message}`);
      return removed;
    }
    if (!data?.length) break;

    const filePaths: string[] = [];
    for (const item of data) {
      const full = folder ? `${folder}/${item.name}` : item.name;
      // Folders typically have null id; files have an id + often metadata
      const looksLikeFolder = item.id == null && !item.name.includes('.');
      if (looksLikeFolder) {
        removed += await emptyStorageFolder(client, full);
      } else {
        filePaths.push(full);
      }
    }

    for (let i = 0; i < filePaths.length; i += 100) {
      const batch = filePaths.slice(i, i + 100);
      const { error: remErr } = await client.storage.from(STORAGE_BUCKET).remove(batch);
      if (remErr) {
        console.warn(`  Storage remove failed: ${remErr.message}`);
      } else {
        removed += batch.length;
      }
    }

    if (data.length < limit) break;
    offset += limit;
  }

  return removed;
}

async function wipeSupabaseStorage() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    console.log('\nSupabase storage: skipped (no SUPABASE_URL / key).');
    return;
  }

  console.log(`\nEmptying Supabase bucket "${STORAGE_BUCKET}"…`);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const removed = await emptyStorageFolder(client, '');
  // org-logos subfolder
  const logos = await emptyStorageFolder(client, 'org-logos');
  console.log(`  Removed ~${removed + logos} storage object(s).`);
}

function wipeLocalVaultDirs() {
  const roots = [
    path.join(process.cwd(), 'vault', 'encrypted'),
    path.join(process.cwd(), 'tmp', 'uploads'),
  ];
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir);
    let n = 0;
    for (const name of entries) {
      const full = path.join(dir, name);
      try {
        fs.rmSync(full, { recursive: true, force: true });
        n++;
      } catch (e) {
        console.warn(`  Could not remove ${full}:`, e);
      }
    }
    console.log(`  Cleared local ${dir} (${n} entries).`);
  }
}

async function main() {
  assertConfirmed();
  console.log('Starting clean wipe for client handoff…');
  console.log('DB host:', (process.env.DIRECT_URL || process.env.DATABASE_URL || '').replace(/:[^:@/]+@/, ':***@'));

  await wipeDatabase();
  await wipeSupabaseStorage();
  console.log('\nLocal filesystem leftovers:');
  wipeLocalVaultDirs();

  console.log(`
DONE.
- Schema + plans preserved
- All users / face registrations / vault / DNA / shares / tracking / investigations cleared
- Supabase vault-files emptied (best effort)

Next for you:
1. Clear browser localStorage / cookies on the app (or use a private window)
2. Register a fresh account and start clean client demos
`);
}

main()
  .catch((err) => {
    console.error('Wipe failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
