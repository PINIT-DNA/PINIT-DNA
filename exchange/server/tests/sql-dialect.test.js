import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteSqlToPostgres, qmarkToDollar } from '../lib/sql-dialect.js';

test('BEGIN IMMEDIATE → BEGIN', () => {
  assert.equal(sqliteSqlToPostgres('BEGIN IMMEDIATE'), 'BEGIN');
});

test('INSERT OR IGNORE → ON CONFLICT DO NOTHING', () => {
  const out = sqliteSqlToPostgres('INSERT OR IGNORE INTO users (pinit_id) VALUES (?)');
  assert.match(out, /^INSERT INTO users/i);
  assert.match(out, /ON CONFLICT DO NOTHING$/i);
});

test('INSERT OR REPLACE → upsert on first column', () => {
  const out = sqliteSqlToPostgres(
    'INSERT OR REPLACE INTO coupons (code, seller_pinit_id, percent_off, active) VALUES (?, ?, ?, 1)'
  );
  assert.match(out, /ON CONFLICT \(code\) DO UPDATE SET/i);
  assert.match(out, /seller_pinit_id = EXCLUDED\.seller_pinit_id/i);
});

test('INSERT OR IGNORE keeps ON CONFLICT before a pre-appended RETURNING', () => {
  // The postgres driver appends RETURNING id before translation. Postgres
  // rejects ON CONFLICT after RETURNING ("syntax error at or near ON"), which
  // broke POST /api/commerce/wishlist in production.
  const out = sqliteSqlToPostgres(
    'INSERT OR IGNORE INTO wishlist (buyer_key, listing_id) VALUES (?, ?) RETURNING id'
  );
  assert.match(out, /^INSERT INTO wishlist/i);
  assert.match(out, /ON CONFLICT DO NOTHING\s+RETURNING id$/i);
  assert.ok(
    out.indexOf('ON CONFLICT') < out.indexOf('RETURNING'),
    'ON CONFLICT must precede RETURNING',
  );
});

test('INSERT OR REPLACE still translates when RETURNING is pre-appended', () => {
  const out = sqliteSqlToPostgres(
    'INSERT OR REPLACE INTO coupons (code, percent_off) VALUES (?, ?) RETURNING id'
  );
  assert.match(out, /ON CONFLICT \(code\) DO UPDATE SET/i);
  assert.match(out, /RETURNING id$/i);
  assert.doesNotMatch(out, /INSERT OR REPLACE/i);
});

test('statements without RETURNING are unaffected', () => {
  const out = sqliteSqlToPostgres('INSERT OR IGNORE INTO users (pinit_id) VALUES (?)');
  assert.match(out, /ON CONFLICT DO NOTHING$/i);
  assert.doesNotMatch(out, /RETURNING/i);
});

test('qmarkToDollar numbers placeholders', () => {
  assert.equal(qmarkToDollar('SELECT * FROM t WHERE a = ? AND b = ?'), 'SELECT * FROM t WHERE a = $1 AND b = $2');
});
