/**
 * Delete an Exchange marketplace account so you can re-register as buyer or seller.
 * Also removes orphan listings left behind when a prior delete missed identity variants.
 *
 * Usage (from exchange/):
 *   node server/scripts/delete-exchange-user.js --list
 *   node server/scripts/delete-exchange-user.js PINIT-EX-XXXXXXXX
 *   node server/scripts/delete-exchange-user.js --code M58CDMZU
 *   node server/scripts/delete-exchange-user.js --purge-orphans
 */
import '../load-env.js';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import { createPostgresDatabase } from '../drivers/postgres.js';
import {
  extractPinitCode,
  identityCandidates,
  pinitCodeExpr,
  toExchangePinitId,
} from '../lib/pinit-identity.js';

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
  console.log('Orphans: node server/scripts/delete-exchange-user.js --purge-orphans');
}

/** Remove published marketplace rows whose seller account no longer exists. */
async function purgeOrphanListings(db) {
  const codeListings = pinitCodeExpr('listings.pinit_id');
  const codeUsers = pinitCodeExpr('u.pinit_id');
  const orphanListings = await all(
    db,
    `SELECT listing_id, pinit_id, title, asset_id, status
       FROM listings
      WHERE NOT EXISTS (
        SELECT 1 FROM users u WHERE ${codeUsers} = ${codeListings}
      )`
  );
  console.log(`Orphan listings: ${orphanListings.length}`);
  for (const row of orphanListings) {
    console.log(`  ${row.listing_id}  seller=${row.pinit_id}  ${row.title || '(untitled)'}  [${row.status}]`);
  }

  const nListings = await run(
    db,
    `DELETE FROM listings
      WHERE NOT EXISTS (
        SELECT 1 FROM users u WHERE ${codeUsers} = ${codeListings}
      )`
  );
  console.log(`Deleted orphan listings: ${nListings}`);

  const codeAssets = pinitCodeExpr('hub_assets.pinit_id');
  const nAssets = await run(
    db,
    `DELETE FROM hub_assets
      WHERE NOT EXISTS (
        SELECT 1 FROM users u WHERE ${pinitCodeExpr('u.pinit_id')} = ${codeAssets}
      )
      AND NOT EXISTS (
        SELECT 1 FROM listings l WHERE l.asset_id = hub_assets.asset_id
      )`
  );
  console.log(`Deleted orphan hub_assets: ${nAssets}`);
}

async function deleteUser(db, pinitIds) {
  const code = extractPinitCode(pinitIds[0] || '');
  if (!code) {
    console.error('Could not resolve Pinit code from:', pinitIds.join(', '));
    process.exit(1);
  }

  const placeholders = pinitIds.map(() => '?').join(', ');
  const users = await all(
    db,
    `SELECT pinit_id, role FROM users WHERE pinit_id IN (${placeholders})
     OR ${pinitCodeExpr('pinit_id')} = ?`,
    [...pinitIds, code]
  );

  const listingRows = await all(
    db,
    `SELECT listing_id, pinit_id, title FROM listings WHERE ${pinitCodeExpr('pinit_id')} = ?`,
    [code]
  );
  if (listingRows.length) {
    console.log(`Listings to remove (${listingRows.length}):`);
    for (const row of listingRows) {
      console.log(`  ${row.listing_id}  ${row.pinit_id}  ${row.title || ''}`);
    }
  }

  if (!users.length && !listingRows.length) {
    console.error('No user or listings found for:', pinitIds.join(', '));
    process.exit(1);
  }

  const like = `%${code}%`;
  const steps = [
    ['seller_onboarding_intents', `DELETE FROM seller_onboarding_intents WHERE ${pinitCodeExpr('pinit_id')} = ?`, [code]],
    ['seller_payment_methods', `DELETE FROM seller_payment_methods WHERE ${pinitCodeExpr('pinit_id')} = ?`, [code]],
    ['portfolio_profiles', `DELETE FROM portfolio_profiles WHERE ${pinitCodeExpr('pinit_id')} = ?`, [code]],
    ['cart_items', 'DELETE FROM cart_items WHERE buyer_key = ? OR buyer_key LIKE ? OR buyer_key LIKE ?', [`PINIT-EX-${code}`, like, `%${code}`]],
    ['wishlist', 'DELETE FROM wishlist WHERE buyer_key = ? OR buyer_key LIKE ?', [`PINIT-EX-${code}`, like]],
    ['reviews', `DELETE FROM reviews WHERE ${pinitCodeExpr('buyer_pinit_id')} = ? OR buyer_pinit_id LIKE ?`, [code, like]],
    ['payment_intents', `DELETE FROM payment_intents WHERE ${pinitCodeExpr('buyer_pinit_id')} = ? OR buyer_key LIKE ?`, [code, like]],
    ['coupons', `DELETE FROM coupons WHERE ${pinitCodeExpr('seller_pinit_id')} = ?`, [code]],
    ['seller_earnings', `DELETE FROM seller_earnings WHERE ${pinitCodeExpr('seller_pinit_id')} = ?`, [code]],
    ['tracking_jobs', `DELETE FROM tracking_jobs WHERE ${pinitCodeExpr('seller_pinit_id')} = ?`, [code]],
    // Match every identity form — old deletes only removed exact PINIT-EX- rows
    // and left Discover showing the same assets under a leftover listing row.
    ['listings', `DELETE FROM listings WHERE ${pinitCodeExpr('pinit_id')} = ?`, [code]],
    ['hub_assets', `DELETE FROM hub_assets WHERE ${pinitCodeExpr('pinit_id')} = ?`, [code]],
    ['users', `DELETE FROM users WHERE ${pinitCodeExpr('pinit_id')} = ?`, [code]],
  ];

  console.log(`Deleting Exchange identity code ${code} (users=${users.length || 0})…`);
  for (const [label, sql, params] of steps) {
    try {
      const n = await run(db, sql, params);
      if (n > 0) console.log(`  ${label}: ${n} row(s)`);
    } catch (e) {
      console.warn(`  ${label}: skipped (${e.message})`);
    }
  }
  console.log('Done. Hard-refresh Exchange Discover to confirm listings are gone.\n');
}

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === '--help' || arg === '-h') {
    console.log(`Usage:
  node server/scripts/delete-exchange-user.js --list
  node server/scripts/delete-exchange-user.js PINIT-EX-XXXXXXXX
  node server/scripts/delete-exchange-user.js --code=XXXXXXXX
  node server/scripts/delete-exchange-user.js --purge-orphans`);
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
    if (arg === '--purge-orphans') {
      await purgeOrphanListings(db);
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
