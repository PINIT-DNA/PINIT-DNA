/**
 * The verified ledger — the portfolio section that reads the record rather than
 * the person's own claims about it.
 *
 * Runs against an isolated SQLite database, never the configured Postgres.
 */
process.env.EXCHANGE_ISOLATED_TEST = '1';
process.env.EXCHANGE_DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';

const { initDatabase } = await import('../database.js');
const { runSql } = await import('../lib/db.js');
const { loadVerifiedLedger, ledgerTimeline } = await import('../lib/portfolio-ledger.js');

await initDatabase();

const RAVI = 'PINIT-EX-RAVI0001';
const OTHER = 'PINIT-EX-SNEH0002';

const asset = (id, owner, title, when, tier, human) => runSql(
  `INSERT INTO hub_assets (asset_id, pinit_id, title, file_type, vertical, dna_record_id,
     human_percent, ai_percent, badge_tier, created_at)
   VALUES (?, ?, ?, 'image', 'images', ?, ?, ?, ?, ?)`,
  [id, owner, title, `DNA-RECORD-${id}-0123456789abcdef`, human, 100 - human, tier, when],
);

await asset('HA-1', RAVI, 'Festive Range', '2026-08-12T00:00:00Z', 'Gold', 95);
await asset('HA-2', RAVI, 'Studio White', '2026-08-04T00:00:00Z', 'Gold', 98);
await asset('HA-3', RAVI, 'Bangles on Linen', '2025-07-29T00:00:00Z', 'Silver', 88);
await asset('HA-4', RAVI, 'Monochrome Studies', '2024-06-21T00:00:00Z', 'Silver', 91);
await asset('HA-9', OTHER, 'Not his', '2026-01-01T00:00:00Z', 'Gold', 90);

test('the ledger is one creator only, newest first', async () => {
  const l = await loadVerifiedLedger(RAVI);
  assert.equal(l.total, 4, 'another creator\'s asset must never appear');
  assert.equal(l.entries.length, 4);
  assert.equal(l.entries[0].title, 'Festive Range', 'newest first');
  assert.equal(l.entries[3].title, 'Monochrome Studies');
});

test('it matches the same person across Pinit ID prefixes', async () => {
  // The vault may hold PINIT-EX-, the portfolio may ask with PINIT-USER-.
  // Both are the same face and must return the same ledger.
  const a = await loadVerifiedLedger('PINIT-USER-RAVI0001');
  const b = await loadVerifiedLedger('PINIT-RAVI0001');
  assert.equal(a.total, 4);
  assert.equal(b.total, 4);
});

test('it never publishes anything that is not safe to publish', async () => {
  const l = await loadVerifiedLedger(RAVI);
  const entry = l.entries[0];
  for (const leaked of ['file_url', 'storage_key', 'preview_url', 'vault_encrypted', 'pinit_id']) {
    assert.equal(entry[leaked], undefined, `${leaked} must not reach a public page`);
  }
  // The DNA record is shown but truncated — enough to check, not a hash dump.
  assert.match(entry.dna, /…$/);
  assert.ok(entry.dna.length <= 12);
});

test('the summary is counted, not claimed', async () => {
  const { summary } = await loadVerifiedLedger(RAVI);
  assert.equal(summary.assets_protected, 4);
  assert.equal(summary.since, 2024, 'earliest protection year — cannot be inflated');
  assert.equal(summary.avg_human_percent, 93);
  assert.deepEqual(summary.tiers, { Gold: 2, Silver: 2 });
});

test('total stays honest when the page only draws some of it', async () => {
  const l = await loadVerifiedLedger(RAVI, { limit: 2 });
  assert.equal(l.shown, 2, 'only two drawn');
  assert.equal(l.total, 4, 'but the count tells the truth');
  assert.equal(l.summary.assets_protected, 4);
});

test('the timeline fills itself, oldest first', async () => {
  const l = await loadVerifiedLedger(RAVI);
  assert.deepEqual(ledgerTimeline(l), [
    { year: 2024, count: 1 },
    { year: 2025, count: 1 },
    { year: 2026, count: 2 },
  ]);
});

test('a creator with nothing protected gets an empty ledger, not a crash', async () => {
  const l = await loadVerifiedLedger('PINIT-EX-NOBODY01');
  assert.equal(l.total, 0);
  assert.deepEqual(l.entries, []);
  assert.equal(l.summary.since, null);
  assert.equal(l.summary.avg_human_percent, null, 'no average until there is something to average');
  assert.deepEqual(ledgerTimeline(l), []);
});

test('a missing Pinit ID is answered, not thrown', async () => {
  const l = await loadVerifiedLedger('');
  assert.equal(l.total, 0);
  assert.deepEqual(l.entries, []);
});
