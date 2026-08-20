/**
 * Postgres adapter with sqlite3-compatible callback API (run/get/all).
 * Uses search_path=exchange so existing unqualified table names keep working.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { sqliteSqlToPostgres, qmarkToDollar } from '../lib/sql-dialect.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeCtx(rowCount, lastID) {
  return { changes: rowCount ?? 0, lastID: lastID ?? undefined };
}

export function createPostgresDatabase(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 10,
  });

  async function withClient(fn) {
    const client = await pool.connect();
    try {
      try {
        await client.query('SET search_path TO exchange, public');
      } catch {
        // Schema may not exist yet (first migrate) — create against public
        await client.query('SET search_path TO public');
      }
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async function exec(sql, params = []) {
    const pgSql = qmarkToDollar(sqliteSqlToPostgres(sql));
    return withClient((client) => client.query(pgSql, params));
  }

  const db = {
    driver: 'postgres',
    pool,

    run(sql, params, cb) {
      let p = params;
      let callback = cb;
      if (typeof params === 'function') {
        callback = params;
        p = [];
      }
      const trimmed = String(sql).trim();
      const needsReturning =
        /^INSERT\s+/i.test(trimmed) &&
        !/RETURNING\b/i.test(trimmed) &&
        /\b(cart_items|wishlist|reviews)\b/i.test(trimmed);

      const finalSql = needsReturning
        ? `${trimmed.replace(/;?\s*$/, '')} RETURNING id`
        : trimmed;

      exec(finalSql, p || [])
        .then((res) => {
          const lastID = res.rows?.[0]?.id;
          const ctx = makeCtx(res.rowCount, lastID);
          callback?.call(ctx, null);
        })
        .catch((err) => callback?.call(makeCtx(0), err));
    },

    get(sql, params, cb) {
      let p = params;
      let callback = cb;
      if (typeof params === 'function') {
        callback = params;
        p = [];
      }
      exec(sql, p || [])
        .then((res) => callback?.(null, res.rows[0] || undefined))
        .catch((err) => callback?.(err));
    },

    all(sql, params, cb) {
      let p = params;
      let callback = cb;
      if (typeof params === 'function') {
        callback = params;
        p = [];
      }
      exec(sql, p || [])
        .then((res) => callback?.(null, res.rows || []))
        .catch((err) => callback?.(err));
    },

    serialize(fn) {
      // sqlite serialize = sequential; for PG we just run the fn (pool handles concurrency)
      fn?.();
    },

    async query(sql, params = []) {
      return exec(sql, params);
    },

    async close() {
      await pool.end();
    },
  };

  return db;
}

export async function initPostgresSchema(db) {
  // Create schema first (no dependency on search_path=exchange)
  await db.query('CREATE SCHEMA IF NOT EXISTS exchange');

  const schemaPath = path.join(__dirname, '..', 'schema', 'exchange.postgres.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const statements = splitSqlStatements(sql).filter((s) => !/^CREATE\s+SCHEMA\b/i.test(s));

  for (const stmt of statements) {
    try {
      await db.query(stmt);
    } catch (err) {
      if (!/already exists/i.test(err.message)) throw err;
    }
  }

  try {
    await db.query('ALTER TABLE exchange.requirements ADD COLUMN IF NOT EXISTS buyer_pinit_id TEXT');
    await db.query('ALTER TABLE exchange.users ADD COLUMN IF NOT EXISTS seller_onboarding_status TEXT DEFAULT \'SELLER_ACTIVE\'');
    await db.query('ALTER TABLE exchange.users ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT');
    await db.query(
      `UPDATE exchange.users SET seller_onboarding_status = 'SELLER_ACTIVE'
       WHERE role IN ('creator', 'admin')
         AND (seller_onboarding_status IS NULL OR seller_onboarding_status = '')`,
    );
  } catch (err) {
    console.warn('[exchange-pg] seller onboarding columns:', err.message);
  }

  // ---------------------------------------------------------------------------
  // Phase 1 — canonical Asset.id linkage on commerce tables.
  // Additive and idempotent: nullable columns only, backfill guarded by
  // `asset_id IS NULL`, and mapping aborted rather than guessed if ambiguous.
  // Cart-level payment_intents (no listing_id) are deliberately left NULL —
  // one payment can span multiple assets, so a single asset_id would be wrong.
  // ---------------------------------------------------------------------------
  await ensureAssetLinkage(db);

  // Optional RLS (non-fatal if policies conflict)
  const rlsPath = path.join(__dirname, '..', 'schema', 'exchange.rls.sql');
  if (fs.existsSync(rlsPath)) {
    const rlsStmts = splitSqlStatements(fs.readFileSync(rlsPath, 'utf8'));
    for (const stmt of rlsStmts) {
      try {
        await db.query(stmt);
      } catch (err) {
        console.warn('[exchange-pg] RLS statement skipped:', err.message);
      }
    }
  }
}

/** Split SQL file into statements; strip full-line comments; keep CREATE bodies intact. */
function splitSqlStatements(sql) {
  const withoutBlock = String(sql).replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlock
    .split(';')
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => !/^\s*--/.test(line))
        .join('\n')
        .trim()
    )
    .filter(Boolean);
}

/**
 * Phase 1: link Exchange commerce rows to the canonical Hub `Asset.id`.
 *
 * `Asset.id` is the ONLY identifier that crosses the Hub<->Exchange boundary.
 * VaultRecord.id and DnaRecord.id are never used as asset_id.
 *
 * Safe to run on every boot: additive DDL, `IS NULL`-guarded backfill.
 */
export async function ensureAssetLinkage(db) {
  const TABLES = ['cart_items', 'wishlist', 'reviews', 'payment_intents', 'refunds', 'seller_earnings'];

  try {
    for (const t of TABLES) {
      await db.query(`ALTER TABLE exchange.${t} ADD COLUMN IF NOT EXISTS asset_id TEXT`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_ex_${t}_asset ON exchange.${t} (asset_id)`);
    }
  } catch (err) {
    console.warn('[exchange-pg] asset linkage columns:', err.message);
    return;
  }

  // A listing or order resolving to more than one asset would make the backfill
  // ambiguous. Abort rather than write a guess.
  try {
    const amb = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM (SELECT listing_id FROM exchange.listings
           GROUP BY listing_id HAVING COUNT(DISTINCT asset_id) > 1) a) AS listing_amb,
        (SELECT COUNT(*) FROM (SELECT order_id FROM exchange.orders_sealed
           GROUP BY order_id HAVING COUNT(DISTINCT asset_id) > 1) b) AS order_amb
    `);
    const row = amb.rows ? amb.rows[0] : amb[0];
    if (Number(row.listing_amb) > 0 || Number(row.order_amb) > 0) {
      console.warn('[exchange-pg] asset linkage backfill ABORTED — ambiguous mapping detected');
      return;
    }
  } catch (err) {
    console.warn('[exchange-pg] asset linkage ambiguity check:', err.message);
    return;
  }

  // Resolve through listings for listing-scoped rows...
  const VIA_LISTING = ['cart_items', 'wishlist', 'reviews', 'payment_intents'];
  // ...and through the sealed order for order-scoped rows.
  const VIA_ORDER = ['refunds', 'seller_earnings'];

  for (const t of VIA_LISTING) {
    try {
      const r = await db.query(`
        UPDATE exchange.${t} t SET asset_id = l.asset_id
          FROM exchange.listings l
         WHERE t.listing_id = l.listing_id
           AND t.asset_id IS NULL
           AND l.asset_id IS NOT NULL
      `);
      if (r && r.rowCount) console.log(`[exchange-pg] ${t}.asset_id backfilled: ${r.rowCount}`);
    } catch (err) {
      console.warn(`[exchange-pg] ${t} asset backfill:`, err.message);
    }
  }

  for (const t of VIA_ORDER) {
    try {
      const r = await db.query(`
        UPDATE exchange.${t} t SET asset_id = o.asset_id
          FROM exchange.orders_sealed o
         WHERE (t.order_id = o.order_id OR t.seal_id = o.seal_id)
           AND t.asset_id IS NULL
           AND o.asset_id IS NOT NULL
      `);
      if (r && r.rowCount) console.log(`[exchange-pg] ${t}.asset_id backfilled: ${r.rowCount}`);
    } catch (err) {
      console.warn(`[exchange-pg] ${t} asset backfill:`, err.message);
    }
  }
}
