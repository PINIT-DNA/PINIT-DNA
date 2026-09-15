/**
 * One-off: wipe Hub + Exchange *user/test rows* while keeping schema, migrations, and plan catalog.
 *
 * Usage (repo root):
 *   node scripts/reset-test-user-data.cjs
 *
 * Does NOT drop tables, indexes, constraints, or _prisma_migrations.
 * Does NOT change application code, APIs, or auth architecture.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function applyEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env) || !String(process.env[key] || '').trim()) {
      process.env[key] = val;
    }
  }
}

applyEnvFile(path.join(ROOT, '.env'));
applyEnvFile(path.join(ROOT, 'exchange', '.env'));

const { Client } = require(path.join(ROOT, 'exchange', 'node_modules', 'pg'));

const PRESERVE_PUBLIC = new Set(['_prisma_migrations', 'plans']);
const PRESERVE_SCHEMAS = new Set(['pg_catalog', 'information_schema', 'landing']);

function pgClient(url) {
  return new Client({
    connectionString: url,
    ssl: String(url).includes('localhost') ? false : { rejectUnauthorized: false },
  });
}

function hubUrl() {
  return String(process.env.DIRECT_URL || process.env.DATABASE_URL || '').trim();
}

function exchangeUrl() {
  return String(process.env.EXCHANGE_DATABASE_URL || hubUrl()).trim();
}

async function tableCounts(client, schema) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
    [schema],
  );
  const out = {};
  for (const { tablename } of rows) {
    const q = await client.query(`SELECT COUNT(*)::int AS c FROM ${schema}.${quoteIdent(tablename)}`);
    out[tablename] = q.rows[0].c;
  }
  return out;
}

function quoteIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Refusing unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

async function listUserTables(client, schema, preserve) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
    [schema],
  );
  return rows.map((r) => r.tablename).filter((t) => !preserve.has(t));
}

async function backup(client, schema, extra) {
  const counts = await tableCounts(client, schema);
  let users = [];
  try {
    if (schema === 'public') {
      const r = await client.query(
        `SELECT id, "shortId", role, "accountType", "isActive" FROM users ORDER BY "createdAt"`,
      );
      users = r.rows;
    } else if (schema === 'exchange') {
      const r = await client.query(
        `SELECT pinit_id, role, account_intent, seller_onboarding_status FROM users ORDER BY created_at`,
      );
      users = r.rows;
    }
  } catch {
    users = [];
  }
  return { schema, at: new Date().toISOString(), counts, users, extra };
}

async function truncateSchema(client, schema, preserve) {
  const tables = await listUserTables(client, schema, preserve);
  if (!tables.length) {
    console.log(`[${schema}] no user tables to truncate`);
    return tables;
  }
  const list = tables.map((t) => `${schema}.${quoteIdent(t)}`).join(', ');
  await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log(`[${schema}] truncated ${tables.length} tables (schema preserved)`);
  return tables;
}

async function isolationCheck(client) {
  const idA = randomUUID();
  const idB = randomUUID();
  const dnaA = randomUUID();
  const dnaB = randomUUID();
  const shortA = `PINIT-ISOA${Date.now().toString(36).slice(-4)}`.slice(0, 16);
  const shortB = `PINIT-ISOB${Date.now().toString(36).slice(-4)}`.slice(0, 16);

  await client.query(
    `INSERT INTO users (id, "shortId", "fullName", role, "accountType", "isActive", "createdAt", "updatedAt")
     VALUES ($1,$2,'Isolation A','USER','INDIVIDUAL', true, NOW(), NOW()),
            ($3,$4,'Isolation B','USER','INDIVIDUAL', true, NOW(), NOW())`,
    [idA, shortA, idB, shortB],
  );
  await client.query(
    `INSERT INTO dna_records (id, "imageFilename", "imageMimeType", "imageSizeBytes", "ownerUserId", status, "createdAt", "updatedAt")
     VALUES ($1,'a.jpg','image/jpeg',100,$2,'COMPLETE', NOW(), NOW()),
            ($3,'b.jpg','image/jpeg',100,$4,'COMPLETE', NOW(), NOW())`,
    [dnaA, idA, dnaB, idB],
  );

  const aSees = await client.query(
    `SELECT id FROM dna_records WHERE "ownerUserId" = $1`,
    [idA],
  );
  const bSees = await client.query(
    `SELECT id FROM dna_records WHERE "ownerUserId" = $1`,
    [idB],
  );
  const aLeak = aSees.rows.some((r) => r.id === dnaB);
  const bLeak = bSees.rows.some((r) => r.id === dnaA);
  const ok =
    aSees.rows.length === 1 &&
    aSees.rows[0].id === dnaA &&
    bSees.rows.length === 1 &&
    bSees.rows[0].id === dnaB &&
    !aLeak &&
    !bLeak;

  await client.query(`DELETE FROM dna_records WHERE id IN ($1,$2)`, [dnaA, dnaB]);
  await client.query(`DELETE FROM users WHERE id IN ($1,$2)`, [idA, idB]);

  return {
    ok,
    userA_rows: aSees.rows.length,
    userB_rows: bSees.rows.length,
    userA_saw_B: aLeak,
    userB_saw_A: bLeak,
  };
}

function clearLocalVault() {
  const dirs = [
    path.join(ROOT, 'vault', 'encrypted'),
    path.join(ROOT, 'tmp', 'uploads'),
  ];
  let n = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name === '.gitkeep') continue;
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      n += 1;
    }
  }
  console.log(`[local] removed ${n} vault/upload files`);
}

function clearLocalSqlite() {
  const dbPath = path.join(ROOT, 'exchange', 'server', 'exchange.db');
  if (!fs.existsSync(dbPath)) {
    console.log('[sqlite] no local exchange.db');
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    try {
      const sqlite3 = require(path.join(ROOT, 'exchange', 'node_modules', 'sqlite3'));
      const db = new sqlite3.Database(dbPath);
      db.all(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
        (err, rows) => {
          if (err) {
            console.warn('[sqlite]', err.message);
            db.close();
            return resolve();
          }
          const runNext = (i) => {
            if (i >= (rows || []).length) {
              db.close();
              console.log(`[sqlite] wiped ${(rows || []).length} tables in exchange.db`);
              return resolve();
            }
            db.run(`DELETE FROM "${rows[i].name}"`, () => runNext(i + 1));
          };
          runNext(0);
        },
      );
    } catch (e) {
      console.warn('[sqlite] skip:', e.message);
      resolve();
    }
  });
}

async function maybeClearSupabaseStorage() {
  const url = process.env.SUPABASE_URL || process.env.EXCHANGE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.EXCHANGE_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log('[storage] skipped (no service key)');
    return;
  }
  try {
    const { createClient } = require(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js'));
    const sb = createClient(url, key);
    const buckets = ['vault-files', 'exchange-previews', 'exchange-deliveries'];
    for (const bucket of buckets) {
      const listed = await sb.storage.from(bucket).list('', { limit: 1000 });
      if (listed.error) {
        console.warn(`[storage] ${bucket}: ${listed.error.message}`);
        continue;
      }
      const names = (listed.data || []).map((f) => f.name).filter(Boolean);
      if (!names.length) {
        console.log(`[storage] ${bucket}: empty`);
        continue;
      }
      const del = await sb.storage.from(bucket).remove(names);
      if (del.error) console.warn(`[storage] ${bucket} delete: ${del.error.message}`);
      else console.log(`[storage] ${bucket}: removed ${names.length} top-level objects`);
    }
  } catch (e) {
    console.warn('[storage] skipped:', e.message);
  }
}

async function main() {
  const url = hubUrl();
  if (!url) {
    console.error('DATABASE_URL / DIRECT_URL missing');
    process.exit(1);
  }

  const backupDir = path.join(ROOT, 'scripts', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `pre-reset-${stamp}.json`);

  const hub = pgClient(url);
  await hub.connect();
  await hub.query('SET search_path TO public');

  const schemas = await hub.query(
    `SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'`,
  );
  console.log('schemas:', schemas.rows.map((r) => r.nspname).join(', '));

  const hubBackup = await backup(hub, 'public');
  const adminLike = (hubBackup.users || []).filter((u) =>
    ['ADMIN', 'SUPER_ADMIN'].includes(String(u.role)),
  );
  console.log(`Hub users before wipe: ${hubBackup.users.length} (ADMIN/SUPER_ADMIN: ${adminLike.length})`);
  if (adminLike.length) {
    console.log('  admin shortIds (will be wiped — re-register to become owner):', adminLike.map((u) => u.shortId).join(', '));
  }

  const ex = pgClient(exchangeUrl());
  await ex.connect();
  await ex.query('SET search_path TO exchange, public');
  const exBackup = await backup(ex, 'exchange');
  console.log(`Exchange users before wipe: ${exBackup.users.length}`);

  fs.writeFileSync(
    backupPath,
    JSON.stringify({ hub: hubBackup, exchange: exBackup, preserved: { public: [...PRESERVE_PUBLIC], schemas: [...PRESERVE_SCHEMAS] } }, null, 2),
    'utf8',
  );
  console.log('Backup written:', backupPath);

  await truncateSchema(hub, 'public', PRESERVE_PUBLIC);
  await truncateSchema(ex, 'exchange', new Set());

  const iso = await isolationCheck(hub);
  console.log('Isolation check (scoped by ownerUserId):', iso);
  if (!iso.ok) {
    console.error('Isolation check FAILED');
    process.exitCode = 1;
  }

  const hubAfter = await tableCounts(hub, 'public');
  const exAfter = await tableCounts(ex, 'exchange');
  const plans = hubAfter.plans ?? 0;
  const migrations = hubAfter._prisma_migrations ?? 0;

  const userish = ['users', 'face_templates', 'voice_templates', 'fingerprint_templates', 'biometric_identities', 'dna_records', 'vault_records'];
  console.log('\nHub counts after wipe:');
  for (const t of userish) console.log(`  ${t}: ${hubAfter[t] ?? 0}`);
  console.log(`  plans (preserved): ${plans}`);
  console.log(`  _prisma_migrations (preserved): ${migrations}`);

  console.log('\nExchange counts after wipe:');
  for (const [t, c] of Object.entries(exAfter)) {
    if (c > 0) console.log(`  ${t}: ${c}`);
  }
  if (Object.values(exAfter).every((c) => c === 0)) console.log('  all exchange tables: 0');

  const leftoverUsers = userish.some((t) => (hubAfter[t] ?? 0) > 0);
  if (leftoverUsers) {
    console.error('Expected user/biometric/DNA/vault tables to be 0');
    process.exitCode = 1;
  }
  if (plans < 1) {
    console.warn('plans table is empty — Hub will recreate FREE/PRO/ENTERPRISE on next subscription ensure');
  }

  await hub.end();
  await ex.end();

  clearLocalVault();
  await clearLocalSqlite();
  await maybeClearSupabaseStorage();

  console.log('\nDone. Next real registration will mint a new unique Hub user + biometric enrollment.');
  console.log('Clear the browser: DevTools → Application → Clear site data for localhost:3002 and localhost:5174');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
