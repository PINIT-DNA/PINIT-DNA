/**
 * Migrate Exchange SQLite → Postgres (exchange schema on shared Supabase project).
 *
 * Usage:
 *   cd exchange
 *   # EXCHANGE_DATABASE_URL in exchange/.env
 *   npm run migrate:postgres
 *
 * Does NOT delete exchange.db. Re-run safe (ON CONFLICT DO NOTHING).
 */
import '../load-env.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import { initPostgresSchema, createPostgresDatabase } from '../drivers/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath =
  process.env.EXCHANGE_DB_PATH || path.join(__dirname, '..', 'exchange.db');
const databaseUrl = String(process.env.EXCHANGE_DATABASE_URL || '').trim();

const TABLES = [
  'users',
  'hub_assets',
  'listings',
  'orders_sealed',
  'requirements',
  'tracking_jobs',
  'cart_items',
  'wishlist',
  'reviews',
  'coupons',
  'payment_intents',
  'asset_commerce_locks',
  'hub_bridge_events',
  'refunds',
  'seller_earnings',
];

const SERIAL_TABLES = ['cart_items', 'wishlist', 'reviews'];

function openSqlite(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(db)));
  });
}

function allSqlite(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function getSqlite(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function runPg(pgDb, sql, params = []) {
  return new Promise((resolve, reject) => {
    pgDb.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function tableExistsSqlite(db, name) {
  const row = await getSqlite(
    db,
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [name]
  );
  return Boolean(row);
}

async function countPg(pgDb, table) {
  const res = await pgDb.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return res.rows[0]?.count ?? 0;
}

async function main() {
  if (!databaseUrl) {
    console.error('EXCHANGE_DATABASE_URL is required');
    process.exit(1);
  }
  if (!fs.existsSync(sqlitePath)) {
    console.error('SQLite file not found:', sqlitePath);
    process.exit(1);
  }

  console.log('SQLite source:', sqlitePath);
  console.log('Postgres target: schema exchange');

  const pgDb = createPostgresDatabase(databaseUrl);
  await initPostgresSchema(pgDb);

  const sqlite = await openSqlite(sqlitePath);
  const summary = [];

  for (const table of TABLES) {
    const exists = await tableExistsSqlite(sqlite, table);
    if (!exists) {
      summary.push({ table, sqlite: 0, postgres: 0, inserted: 0, skipped: 0, failed: 0, note: 'missing_in_sqlite' });
      continue;
    }

    const rows = await allSqlite(sqlite, `SELECT * FROM ${table}`);
    let inserted = 0;
    let skipped = 0;
    let failed = 0;
    const failures = [];

    for (const row of rows) {
      const cols = Object.keys(row);
      const placeholders = cols.map(() => '?').join(', ');
      const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
      try {
        const before = await countPg(pgDb, table);
        await runPg(
          pgDb,
          sql,
          cols.map((c) => row[c])
        );
        const after = await countPg(pgDb, table);
        if (after > before) inserted += 1;
        else skipped += 1;
      } catch (err) {
        failed += 1;
        failures.push(err.message);
      }
    }

    const pgCount = await countPg(pgDb, table);
    summary.push({
      table,
      sqlite: rows.length,
      postgres: pgCount,
      inserted,
      skipped,
      failed,
      sampleErrors: failures.slice(0, 3),
    });
  }

  for (const table of SERIAL_TABLES) {
    try {
      await pgDb.query(
        `SELECT setval(pg_get_serial_sequence('exchange.${table}', 'id'), COALESCE((SELECT MAX(id) FROM exchange.${table}), 1), true)`
      );
    } catch (err) {
      console.warn(`[migrate] serial sync ${table}:`, err.message);
    }
  }

  console.log('\n=== Migration summary ===');
  for (const row of summary) {
    const ok = row.sqlite === row.postgres || (row.failed === 0 && row.postgres >= row.sqlite);
    console.log(
      `${ok ? 'OK' : '!!'} ${row.table}: sqlite=${row.sqlite} postgres=${row.postgres} inserted=${row.inserted} skipped=${row.skipped} failed=${row.failed}${row.note ? ` (${row.note})` : ''}`
    );
    if (row.sampleErrors?.length) console.log('   errors:', row.sampleErrors.join(' | '));
  }

  const bad = summary.filter((s) => s.failed > 0 || (s.sqlite > 0 && s.postgres < s.sqlite));
  console.log('\nSQLite preserved (not deleted):', sqlitePath);
  if (bad.length) {
    console.error('Failures on:', bad.map((m) => m.table).join(', '));
    process.exitCode = 1;
  } else {
    console.log('Migration verified — point runtime at Postgres via EXCHANGE_DATABASE_URL.');
  }

  sqlite.close();
  await pgDb.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
