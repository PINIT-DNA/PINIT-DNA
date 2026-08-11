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

test('qmarkToDollar numbers placeholders', () => {
  assert.equal(qmarkToDollar('SELECT * FROM t WHERE a = ? AND b = ?'), 'SELECT * FROM t WHERE a = $1 AND b = $2');
});
