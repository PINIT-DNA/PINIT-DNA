/**
 * Delete an Exchange marketplace account so you can re-register as buyer or seller.
 *
 * Usage (from exchange/):
 *   node server/scripts/delete-exchange-user.js --list
 *   node server/scripts/delete-exchange-user.js PINIT-EX-XXXXXXXX
 *   node server/scripts/delete-exchange-user.js --code M58CDMZU
 */
import '../load-env.js';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import { createPostgresDatabase } from '../drivers/postgres.js';
import { identityCandidates, toExchangePinitId } from '../lib/pinit-identity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const forceSqlite = String(process.env.EXCHANGE_FORCE_SQLITE || '').trim() === '1';
const databaseUrl = forceSqlite ? '' : String(process.env.EXCHANGE_DATABASE_URL || '').trim();
const driver = databaseUrl ? 'postgres' : 'sqlite';

function openSqlite() {
  const dbPath = process.env.EXCHANGE_DB_PATH || path.join(__dirname, '..', 'exchange.db');
  return new sqlite3.Database(dbPath);
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this?.changes ?? 0);
    });
  });
}

function resolvePinitIds(arg) {
  if (!arg) return [];
  if (arg.startsWith('PINIT-')) return identityCandidates(arg);
  if (arg.startsWith('--code=')) {
    return identityCandidates(toExchangePinitId(`PINIT-EX-${arg.slice(7)}`));
  }
  return identityCandidates(toExchangePinitId(`PINIT-EX-${arg}`));
}

async function listUsers(db) {
  const rows = await all(
    db,
    `SELECT pinit_id, role, account_intent, seller_onboarding_status, created_at
     FROM users ORDER BY created_at DESC`
  );
  if (!rows.length) {
    console.log('No Exchange accounts found.');
    return;
  }
  console.log(`Exchange accounts (${driver}):\n`);
  for (const r of rows) {
    console.log(
      `  ${r.pinit_id}  role=${r.role}  intent=${r.account_intent || '-'}  seller=${r.seller_onboarding_status || '-'}`
    );
  }
  console.log('\nDelete: node server/scripts/delete-exchange-user.js PINIT-EX-...');
}

async function deleteUser(db, pinitIds) {
  const placeholders = pinitIds.map(() => '?').join(', ');
  const users = await all(
    db,
    `SELECT pinit_id, role FROM users WHERE pinit_id IN (${placeholders})`,
    pinitIds
  );
  if (!users.length) {
    console.error('No user found for:', pinitIds.join(', '));
    process.exit(1);
  }

  for (const u of users) {
    const id = u.pinit_id;
    const code = id.replace(/^PINIT-(EX|USER|ORG)-/, '');
    const like = `%${code}%`;

    const steps = [
      ['seller_onboarding_intents', 'DELETE FROM seller_onboarding_intents WHERE pinit_id = ?', [id]],
      ['seller_payment_methods', 'DELETE FROM seller_payment_methods WHERE pinit_id = ?', [id]],
      ['portfolio_profiles', 'DELETE FROM portfolio_profiles WHERE pinit_id = ?', [id]],
      ['cart_items', 'DELETE FROM cart_items WHERE buyer_key = ? OR buyer_key LIKE ?', [id, like]],
      ['wishlist', 'DELETE FROM wishlist WHERE buyer_key = ? OR buyer_key LIKE ?', [id, like]],
      ['reviews', 'DELETE FROM reviews WHERE buyer_pinit_id = ? OR buyer_pinit_id LIKE ?', [id, like]],
      ['payment_intents', 'DELETE FROM payment_intents WHERE buyer_pinit_id = ? OR buyer_key = ?', [id, id]],
      ['coupons', 'DELETE FROM coupons WHERE seller_pinit_id = ?', [id]],
      ['seller_earnings', 'DELETE FROM seller_earnings WHERE seller_pinit_id = ?', [id]],
      ['tracking_jobs', 'DELETE FROM tracking_jobs WHERE seller_pinit_id = ?', [id]],
      ['listings', 'DELETE FROM listings WHERE pinit_id = ?', [id]],
      ['hub_assets', 'DELETE FROM hub_assets WHERE pinit_id = ?', [id]],
      ['users', 'DELETE FROM users WHERE pinit_id = ?', [id]],
    ];

    console.log(`Deleting Exchange account ${id} (role=${u.role})…`);
    for (const [label, sql, params] of steps) {
      try {
        const n = await run(db, sql, params);
        if (n > 0) console.log(`  ${label}: ${n} row(s)`);
      } catch (e) {
        console.warn(`  ${label}: skipped (${e.message})`);
      }
    }
    console.log(`Done. Sign out of Exchange, clear localStorage, then sign in as Buyer.\n`);
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === '--help' || arg === '-h') {
    console.log(`Usage:
  node server/scripts/delete-exchange-user.js --list
  node server/scripts/delete-exchange-user.js PINIT-EX-XXXXXXXX
  node server/scripts/delete-exchange-user.js --code=XXXXXXXX`);
    process.exit(0);
  }

  let db;
  if (driver === 'postgres') {
    db = createPostgresDatabase(databaseUrl);
    console.log('[delete] driver: postgres (exchange schema)\n');
  } else {
    db = openSqlite();
    console.log('[delete] driver: sqlite\n');
  }

  try {
    if (arg === '--list') {
      await listUsers(db);
      return;
    }

    const pinitIds = arg.startsWith('--code=')
      ? resolvePinitIds(arg)
      : resolvePinitIds(arg);

    await deleteUser(db, pinitIds);
  } finally {
    if (driver === 'postgres') await db.pool.end();
    else db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
