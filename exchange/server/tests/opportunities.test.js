/**
 * Opportunities end-to-end: brief → invite → proposal → award, plus collabs,
 * asks and team splits.
 *
 * Runs against an isolated SQLite database (EXCHANGE_ISOLATED_TEST=1), never
 * the configured Postgres — these tests write proposals and award briefs, and
 * production is not a fixture.
 */
process.env.EXCHANGE_ISOLATED_TEST = '1';
process.env.EXCHANGE_DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

const { initDatabase } = await import('../database.js');
const { runSql, getSql, allSql } = await import('../lib/db.js');
const { default: opportunities } = await import('../routes/opportunities.js');
const { default: requirements } = await import('../routes/requirements.js');

await initDatabase();

/* ── fixtures ─────────────────────────────────────────────────────────── */

const RAVI = 'PINIT-EX-RAVI0001';   // creator, has assets
const SNEHA = 'PINIT-EX-SNEH0002';  // creator, has assets
const BUYER = 'PINIT-EX-BUYR0003';  // buyer, owns the brief
const ARUN = 'PINIT-EX-ARUN0004';   // creator, uninvolved
let MINE = '';                      // the brief a creator posts, below
const REQ = 'REQ-T100';

await runSql(
  `INSERT INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan)
   VALUES (?, 'PX-1', 'Ravi K', 'ravi@example.com', 'creator', 'verified', 1, 'pro')`, [RAVI],
);
await runSql(
  `INSERT INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan)
   VALUES (?, 'PX-2', 'Sneha M', 'sneha@example.com', 'creator', 'verified', 1, 'pro')`, [SNEHA],
);
await runSql(
  `INSERT INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, buyer_enabled)
   VALUES (?, 'PX-3', 'Meridian Studio', 'buy@example.com', 'buyer', 'verified', 1, 1)`, [BUYER],
);
await runSql(
  `INSERT INTO users (pinit_id, exchange_id, name, email, role, kyc_status, biometric_verified, seller_plan)
   VALUES (?, 'PX-4', 'Arun T', 'arun@example.com', 'creator', 'verified', 1, 'pro')`, [ARUN],
);

const asset = (assetId, owner, title, vertical) => runSql(
  `INSERT INTO hub_assets (asset_id, pinit_id, title, file_type, vertical, dna_record_id, human_percent, ai_percent, badge_tier)
   VALUES (?, ?, ?, 'image', ?, ?, 95, 5, 'Gold')`,
  [assetId, owner, title, vertical, `DNA-${assetId}`],
);
await asset('HA-R1', RAVI, 'Festive Set 04', 'images');
await asset('HA-R2', RAVI, 'Studio white 02', 'images');
await asset('HA-S1', SNEHA, 'Bangles on linen', 'images');

await runSql(
  `INSERT INTO requirements (req_id, buyer_name, buyer_org, title, description, vertical, budget, deadline, proposals_count, status, buyer_pinit_id, creators_needed)
   VALUES (?, 'Meridian Studio', 'Meridian', 'Product photography', 'Jewellery catalogue', 'images', 68000, '2026-09-15', 0, 'open', ?, 2)`,
  [REQ, BUYER],
);

/* ── harness ──────────────────────────────────────────────────────────── */

const app = express();
app.use(express.json());
app.use('/api/requirements', requirements);
app.use('/api/opportunities', opportunities);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, as, body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as ? { 'X-Pinit-Id': as } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.after(() => server.close());

/* ── the flow ─────────────────────────────────────────────────────────── */

test('the legacy propose route no longer fakes a count', async () => {
  const r = await call('POST', `/api/requirements/${REQ}/propose`, RAVI);
  assert.equal(r.status, 410);
  const brief = await getSql('SELECT proposals_count FROM requirements WHERE req_id = ?', [REQ]);
  assert.equal(Number(brief.proposals_count), 0, 'the old endpoint must not increment anything');
});

test('a proposal with no attached work is refused', async () => {
  const r = await call('POST', `/api/opportunities/briefs/${REQ}/propose`, RAVI, { asset_ids: [] });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /protected asset/i);
});

test('a creator cannot attach work they do not own', async () => {
  const r = await call('POST', `/api/opportunities/briefs/${REQ}/propose`, RAVI, {
    asset_ids: ['HA-S1'], // Sneha's
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'NOT_YOUR_ASSET');
});

test('a proposal is a row, not a counter', async () => {
  const r = await call('POST', `/api/opportunities/briefs/${REQ}/propose`, RAVI, {
    asset_ids: ['HA-R1', 'HA-R2'],
    note: 'Two sets from the same shoot.',
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.attached, 2);

  const rows = await allSql('SELECT * FROM proposals WHERE req_id = ?', [REQ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].creator_pinit_id, 'PINIT-RAVI0001', 'stored in root form');
  assert.deepEqual(JSON.parse(rows[0].asset_ids), ['HA-R1', 'HA-R2']);
});

test('re-submitting replaces the answer rather than adding a second', async () => {
  await call('POST', `/api/opportunities/briefs/${REQ}/propose`, RAVI, {
    asset_ids: ['HA-R1'], note: 'Just the one, actually.',
  });
  const rows = await allSql('SELECT * FROM proposals WHERE req_id = ?', [REQ]);
  assert.equal(rows.length, 1, 'one answer per creator');
  assert.deepEqual(JSON.parse(rows[0].asset_ids), ['HA-R1']);
  assert.match(rows[0].note, /Just the one/);
});

test('the buyer sees the creator, the work and ledger credentials', async () => {
  await call('POST', `/api/opportunities/briefs/${REQ}/propose`, SNEHA, { asset_ids: ['HA-S1'] });

  const r = await call('GET', `/api/opportunities/briefs/${REQ}/proposals`, BUYER);
  assert.equal(r.status, 200);
  assert.equal(r.body.proposals.length, 2);

  const ravi = r.body.proposals.find((p) => p.creator.name === 'Ravi K');
  assert.ok(ravi, 'the buyer can now tell who proposed');
  assert.equal(ravi.assets[0].title, 'Festive Set 04');
  assert.equal(ravi.credentials.assets_protected, 2, 'counted from hub_assets, not self-reported');
  assert.equal(ravi.credentials.licences_sealed, 0);
  // The attached work must never carry a file path.
  assert.equal(ravi.assets[0].file_url, undefined);
});

test('proposals on someone else\'s brief are refused', async () => {
  const r = await call('GET', `/api/opportunities/briefs/${REQ}/proposals`, RAVI);
  assert.ok(r.status === 403 || r.status === 401, `expected a refusal, got ${r.status}`);
});

test('an invite makes the brief rank first for that creator', async () => {
  await runSql(
    `INSERT INTO requirements (req_id, buyer_name, buyer_org, title, description, vertical, budget, deadline, proposals_count, status, buyer_pinit_id)
     VALUES ('REQ-T200', 'Other', 'Other', 'Newer brief', 'x', 'video', 100, '2026-10-01', 0, 'open', ?)`,
    [BUYER],
  );
  const inv = await call('POST', '/api/opportunities/briefs/REQ-T200/invite', BUYER, {
    pinit_ids: [SNEHA],
  });
  assert.equal(inv.status, 201);
  assert.equal(inv.body.invited, 1);

  // Inviting the same creator twice is a no-op, not a duplicate row.
  const again = await call('POST', '/api/opportunities/briefs/REQ-T200/invite', BUYER, {
    pinit_ids: [SNEHA],
  });
  assert.equal(again.body.invited, 0);
  assert.match(again.body.skipped[0].why, /Already invited/);

  const list = await call('GET', '/api/opportunities/briefs', SNEHA);
  assert.equal(list.body.briefs[0].req_id, 'REQ-T200', 'invited brief sorts first');
  assert.equal(list.body.briefs[0].invited, true);
});

test('questions are on the brief and visible to everyone answering it', async () => {
  const q = await call('POST', `/api/opportunities/briefs/${REQ}/questions`, RAVI, {
    body: 'Is the 18-month window from delivery or first publication?',
  });
  assert.equal(q.status, 201);
  await call('POST', `/api/opportunities/briefs/${REQ}/questions`, BUYER, {
    body: 'From first publication.',
  });

  // Sneha did not ask, but can read both.
  const seen = await call('GET', `/api/opportunities/briefs/${REQ}`, SNEHA);
  assert.equal(seen.body.questions.length, 2);
  assert.equal(seen.body.questions[0].author_role, 'creator');
  assert.equal(seen.body.questions[1].author_role, 'buyer');
});

test('awarding closes the brief and records who won', async () => {
  const props = await call('GET', `/api/opportunities/briefs/${REQ}/proposals`, BUYER);
  const winner = props.body.proposals.find((p) => p.creator.name === 'Ravi K');

  const award = await call('POST', `/api/opportunities/briefs/${REQ}/award`, BUYER, {
    proposal_id: winner.proposal_id,
  });
  assert.equal(award.status, 200);

  const brief = await getSql('SELECT * FROM requirements WHERE req_id = ?', [REQ]);
  assert.equal(brief.status, 'awarded');
  assert.equal(brief.awarded_to_pinit_id, 'PINIT-RAVI0001');
  assert.equal(brief.awarded_proposal_id, winner.proposal_id);

  const losing = await getSql(
    "SELECT status FROM proposals WHERE req_id = ? AND creator_pinit_id = 'PINIT-SNEH0002'", [REQ],
  );
  assert.equal(losing.status, 'declined');
});

test('a brief cannot be awarded twice', async () => {
  const props = await allSql('SELECT proposal_id FROM proposals WHERE req_id = ?', [REQ]);
  const r = await call('POST', `/api/opportunities/briefs/${REQ}/award`, BUYER, {
    proposal_id: props[0].proposal_id,
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'ALREADY_AWARDED');
});

test('an awarded brief stops taking proposals', async () => {
  const r = await call('POST', `/api/opportunities/briefs/${REQ}/propose`, SNEHA, {
    asset_ids: ['HA-S1'],
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'BRIEF_CLOSED');
});

test('the award shows up as a ledger credential', async () => {
  const r = await call('GET', '/api/opportunities/creators', SNEHA);
  const ravi = r.body.creators.find((c) => c.name === 'Ravi K');
  assert.equal(ravi.credentials.briefs_delivered, 1);
  assert.equal(ravi.credentials.assets_protected, 2);
  // Never expose contact details in the directory.
  assert.equal(ravi.email, undefined);
});

test('a team split must add up to 100 and everyone must accept', async () => {
  const bad = await call('POST', '/api/opportunities/briefs/REQ-T200/team', RAVI, {
    members: [
      { pinit_id: RAVI, role_label: 'shoot', split_percent: 60 },
      { pinit_id: SNEHA, role_label: 'retouch', split_percent: 30 },
    ],
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /100%/);

  const ok = await call('POST', '/api/opportunities/briefs/REQ-T200/team', RAVI, {
    members: [
      { pinit_id: RAVI, role_label: 'shoot', split_percent: 60 },
      { pinit_id: SNEHA, role_label: 'retouch', split_percent: 40 },
    ],
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.team.all_accepted, false, 'the lead accepting is not everyone accepting');
  assert.equal(ok.body.team.members.find((m) => m.name === 'Ravi K').accepted, true);

  const accept = await call('POST', `/api/opportunities/teams/${ok.body.team.team_id}/accept`, SNEHA);
  assert.equal(accept.status, 200);
  assert.equal(accept.body.team.all_accepted, true);
  assert.equal(accept.body.team.status, 'ready');
});

test('an ask to collaborate needs a reason and cannot be duplicated', async () => {
  const bare = await call('POST', '/api/opportunities/asks', RAVI, { to_pinit_id: SNEHA });
  assert.equal(bare.status, 400);
  assert.match(bare.body.message, /what you want to collaborate on/i);

  const sent = await call('POST', '/api/opportunities/asks', RAVI, {
    to_pinit_id: SNEHA, reason: 'Answering REQ-4118 together — I shoot, you retouch. 60/40?',
  });
  assert.equal(sent.status, 201);

  const dupe = await call('POST', '/api/opportunities/asks', RAVI, {
    to_pinit_id: SNEHA, reason: 'again',
  });
  assert.equal(dupe.status, 409);

  const self = await call('POST', '/api/opportunities/asks', RAVI, {
    to_pinit_id: RAVI, reason: 'me',
  });
  assert.equal(self.status, 400);
});

test('only the recipient can answer an ask', async () => {
  const ask = await getSql("SELECT ask_id FROM collab_asks WHERE status = 'pending'");
  const wrong = await call('POST', `/api/opportunities/asks/${ask.ask_id}/respond`, RAVI, {
    decision: 'accepted',
  });
  assert.equal(wrong.status, 404, 'the sender cannot accept their own ask');

  const right = await call('POST', `/api/opportunities/asks/${ask.ask_id}/respond`, SNEHA, {
    decision: 'accepted',
  });
  assert.equal(right.status, 200);
});

test('my activity gathers what is actually in flight', async () => {
  await call('POST', '/api/opportunities/collabs', SNEHA, {
    title: 'Editor for a documentary short', looking_for: 'Video editor',
  });

  const r = await call('GET', '/api/opportunities/activity', SNEHA);
  assert.equal(r.status, 200);
  assert.equal(r.body.collabs.length, 1);
  assert.equal(r.body.asks_received.length, 1);
  assert.equal(r.body.asks_received[0].creator, 'Ravi K');
  assert.ok(r.body.proposals.length >= 1);
  // The brief a proposal belongs to is resolved, not left as a bare id.
  assert.equal(r.body.proposals[0].brief.title, 'Product photography');
});

test('proposal counts are derived, never trusted from the column', async () => {
  await runSql('UPDATE requirements SET proposals_count = 999 WHERE req_id = ?', [REQ]);
  const list = await call('GET', '/api/requirements', null);
  const brief = list.body.find((b) => b.req_id === REQ);
  assert.equal(brief.proposals_count, 2, 'the rows win over the stored column');
});

/* == A creator posting an opportunity ================================== */

test('a creator can post an opportunity, not only a buyer', async () => {
  // Ravi needs photographs for his own project. Nothing about that is
  // different from an agency needing them.
  const r = await call('POST', '/api/requirements', RAVI, {
    buyer_name: 'Ravi K',
    buyer_org: 'Independent creator',
    title: 'Need still photographs for a short film',
    description: 'Three shoot days, behind the scenes stills.',
    vertical: 'images',
    budget: 15000,
    deadline: '2026-10-30',
    creators_needed: 1,
  });
  assert.equal(r.status, 201, 'a creator posting must not be refused as a non-buyer');
  assert.ok(r.body.requirement.req_id);
  MINE = r.body.requirement.req_id;
});

test('your own posting is not open work to you', async () => {
  const mine = await call('GET', '/api/opportunities/briefs', RAVI);
  assert.ok(
    !mine.body.briefs.some((b) => b.req_id === MINE),
    'a creator must not see their own opportunity in the list they answer',
  );

  // But everyone else does.
  const theirs = await call('GET', '/api/opportunities/briefs', SNEHA);
  assert.ok(theirs.body.briefs.some((b) => b.req_id === MINE));
});

test('you cannot answer your own opportunity', async () => {
  const r = await call('POST', `/api/opportunities/briefs/${MINE}/propose`, RAVI, {
    asset_ids: ['HA-R1'],
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'YOUR_OWN_BRIEF');
});

test('you cannot invite yourself to your own opportunity', async () => {
  const r = await call('POST', `/api/opportunities/briefs/${MINE}/invite`, RAVI, {
    pinit_ids: [RAVI, SNEHA],
  });
  assert.equal(r.body.invited, 1, 'only the other creator is invited');
  assert.match(r.body.skipped[0].why, /cannot invite yourself/i);
});

test('the creator who posted reviews and awards it like any other poster', async () => {
  const sent = await call('POST', `/api/opportunities/briefs/${MINE}/propose`, SNEHA, {
    asset_ids: ['HA-S1'], note: 'Happy to shoot these.',
  });
  assert.equal(sent.status, 201);

  const review = await call('GET', `/api/opportunities/briefs/${MINE}/proposals`, RAVI);
  assert.equal(review.status, 200, 'the poster can review proposals on what they posted');
  assert.equal(review.body.proposals.length, 1);
  assert.equal(review.body.proposals[0].creator.name, 'Sneha M');

  const award = await call('POST', `/api/opportunities/briefs/${MINE}/award`, RAVI, {
    proposal_id: review.body.proposals[0].proposal_id,
  });
  assert.equal(award.status, 200);

  // And a stranger still cannot.
  const nosy = await call('GET', `/api/opportunities/briefs/${MINE}/proposals`, ARUN);
  assert.equal(nosy.status, 403);
});
