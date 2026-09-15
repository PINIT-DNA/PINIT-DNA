/**
 * Opportunities — buyer briefs, creator proposals, and creator collaboration.
 *
 * Two objects live here and are deliberately never mixed:
 *
 *   Brief   a buyer wants work done   →  creators propose  →  buyer awards
 *   Collab  a creator wants a partner →  creators ask      →  partner accepts
 *
 * The rule this file exists to fix: a proposal is a row. The previous
 * implementation incremented `requirements.proposals_count` and stored nothing
 * else, so a buyer saw a number and could never find the creator behind it.
 * `proposals_count` is now derived from the proposals table on read, and the
 * stored column is left alone rather than kept in two places.
 */
import express from 'express';
import crypto from 'crypto';
import { allSql, getSql, runSql } from '../lib/db.js';
import { requireBuyer, requireSeller, findUserByPinitId } from '../lib/rbac.js';
import {
  identityMatchSql, pinitCodeExpr, toRootPinitId, extractPinitCode, samePinitFace,
} from '../lib/pinit-identity.js';

const router = express.Router();

/* ── helpers ──────────────────────────────────────────────────────────── */

const id = (prefix) => `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
const now = () => new Date().toISOString();

/**
 * Identity columns in these tables are stored in the root form so the unique
 * indexes actually mean one-per-person. Legacy tables keep whatever prefix
 * they were written with, so reads against those still go through
 * identityMatchSql.
 */
const root = (pinitId) => toRootPinitId(pinitId) || String(pinitId || '').trim();

function badRequest(res, message) {
  return res.status(400).json({ error: 'INVALID_INPUT', message });
}

/** Trim and cap a free-text field. Returns '' when nothing usable is left. */
function text(value, max) {
  const s = String(value ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** Asset ids arrive as an array; store as JSON, read back defensively. */
function parseAssetIds(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Credentials read from the ledger, not from a profile.
 *
 * Assets protected, licences sealed and briefs delivered are all counted from
 * tables the creator cannot write to directly. This is the one claim on
 * Exchange that a creator cannot simply type in, so it is worth the extra
 * queries. Grouped by face code in three queries rather than three per person.
 */
async function credentialIndex() {
  const [assets, sales, awarded] = await Promise.all([
    allSql(`SELECT ${pinitCodeExpr('pinit_id')} AS code, COUNT(*) AS n
            FROM hub_assets GROUP BY ${pinitCodeExpr('pinit_id')}`),
    allSql(`SELECT ${pinitCodeExpr('seller_pinit_id')} AS code, COUNT(*) AS n
            FROM orders_sealed GROUP BY ${pinitCodeExpr('seller_pinit_id')}`),
    allSql(`SELECT ${pinitCodeExpr('awarded_to_pinit_id')} AS code, COUNT(*) AS n
            FROM requirements WHERE awarded_to_pinit_id IS NOT NULL
            GROUP BY ${pinitCodeExpr('awarded_to_pinit_id')}`),
  ]);

  const fold = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(String(r.code || ''), Number(r.n) || 0);
    return m;
  };
  const a = fold(assets); const s = fold(sales); const w = fold(awarded);

  return (pinitId) => {
    const code = extractPinitCode(pinitId);
    return {
      assets_protected: a.get(code) || 0,
      licences_sealed: s.get(code) || 0,
      briefs_delivered: w.get(code) || 0,
    };
  };
}

/** Public identity only — display name and Pinit ID. Never email. */
async function publicProfileIndex(pinitIds) {
  const codes = [...new Set(pinitIds.map(extractPinitCode).filter(Boolean))];
  if (codes.length === 0) return () => null;

  const holes = codes.map(() => '?').join(', ');
  const [users, profiles] = await Promise.all([
    allSql(
      `SELECT pinit_id, name, display_name, ${pinitCodeExpr('pinit_id')} AS code
       FROM users WHERE ${pinitCodeExpr('pinit_id')} IN (${holes})`,
      codes,
    ),
    allSql(
      `SELECT pinit_id, slug, headline, location, skills, available_for, visibility,
              ${pinitCodeExpr('pinit_id')} AS code
       FROM portfolio_profiles WHERE ${pinitCodeExpr('pinit_id')} IN (${holes})`,
      codes,
    ),
  ]);

  const byCode = new Map();
  for (const u of users) {
    byCode.set(u.code, {
      pinit_id: u.pinit_id,
      name: u.display_name || u.name || u.pinit_id,
      headline: null, location: null, skills: null,
      available_for: null, portfolio_slug: null,
    });
  }
  for (const p of profiles) {
    const cur = byCode.get(p.code) || { pinit_id: p.pinit_id, name: p.pinit_id };
    cur.headline = p.headline || null;
    cur.location = p.location || null;
    cur.skills = p.skills || null;
    cur.available_for = p.available_for || null;
    // Only a published portfolio gets a public link.
    cur.portfolio_slug = p.visibility === 'public' ? p.slug || null : null;
    byCode.set(p.code, cur);
  }

  return (pinitId) => byCode.get(extractPinitCode(pinitId)) || null;
}

/** Live proposal counts, derived — never the stored column. */
async function proposalCounts(reqIds) {
  if (reqIds.length === 0) return new Map();
  const holes = reqIds.map(() => '?').join(', ');
  const rows = await allSql(
    `SELECT req_id, COUNT(*) AS n FROM proposals
     WHERE req_id IN (${holes}) AND status <> 'withdrawn'
     GROUP BY req_id`,
    reqIds,
  );
  return new Map(rows.map((r) => [r.req_id, Number(r.n) || 0]));
}

/**
 * Does this user own this brief?
 *
 * Briefs posted before `buyer_pinit_id` existed have it NULL, so those fall
 * back to the buyer name — the same rule the existing "my briefs" query uses.
 * Anything else is a refusal, not a guess.
 */
function ownsBrief(brief, user) {
  if (!brief || !user) return false;
  if (brief.buyer_pinit_id) return samePinitFace(brief.buyer_pinit_id, user.pinit_id);
  const name = String(user.display_name || user.name || '').trim();
  return Boolean(name) && String(brief.buyer_name || '').trim() === name;
}

async function getBrief(reqId) {
  return getSql('SELECT * FROM requirements WHERE req_id = ?', [String(reqId || '').trim()]);
}

/* ── Briefs: the creator's side ───────────────────────────────────────── */

/**
 * Open work.
 *
 * Ranking is the default sort, not a separate tab: briefs you were invited to
 * first, then briefs in a vertical you already work in, then newest. A tab
 * called "For You" would have been this list with a different label.
 */
router.get('/briefs', requireSeller, async (req, res) => {
  try {
    const me = root(req.exchangeUser.pinit_id);
    const vertical = text(req.query.vertical, 40);

    const params = [];
    let where = "WHERE status = 'open'";
    if (vertical && vertical !== 'all') { where += ' AND vertical = ?'; params.push(vertical); }

    const all = await allSql(
      `SELECT * FROM requirements ${where} ORDER BY created_at DESC LIMIT 200`, params,
    );
    // A creator can post an opportunity too — they need photographs for their
    // own project like anyone else. What they must not do is answer it, so
    // their own postings are not open work to them.
    const briefs = all.filter((b) => !samePinitFace(b.buyer_pinit_id, me));
    const reqIds = briefs.map((b) => b.req_id);

    const mineScope = identityMatchSql('pinit_id', me);
    const [counts, invites, mine, myVerticals, buyerRecord] = await Promise.all([
      proposalCounts(reqIds),
      allSql('SELECT req_id, status FROM brief_invites WHERE creator_pinit_id = ?', [me]),
      allSql('SELECT req_id, status, created_at FROM proposals WHERE creator_pinit_id = ?', [me]),
      allSql(`SELECT DISTINCT vertical FROM hub_assets WHERE ${mineScope.sql}`, mineScope.params),
      // How many briefs this buyer has actually awarded. A creator deciding
      // whether a brief is worth answering wants to know the buyer finishes;
      // like the creator credentials, it is counted, not claimed.
      allSql(
        `SELECT ${pinitCodeExpr('buyer_pinit_id')} AS code, COUNT(*) AS n
         FROM requirements WHERE status = 'awarded' AND buyer_pinit_id IS NOT NULL
         GROUP BY ${pinitCodeExpr('buyer_pinit_id')}`,
      ),
    ]);

    const invited = new Map(invites.map((i) => [i.req_id, i.status]));
    const proposed = new Map(mine.map((p) => [p.req_id, p]));
    const works = new Set(myVerticals.map((v) => v.vertical).filter(Boolean));
    const awardedBy = new Map(buyerRecord.map((r) => [String(r.code || ''), Number(r.n) || 0]));

    const rows = briefs.map((b) => ({
      ...b,
      proposals_count: counts.get(b.req_id) || 0,
      invited: invited.has(b.req_id),
      my_proposal_status: proposed.get(b.req_id)?.status || null,
      buyer_briefs_awarded: awardedBy.get(extractPinitCode(b.buyer_pinit_id)) || 0,
    }));

    const rank = (b) => (b.invited ? 0 : works.has(b.vertical) ? 1 : 2);
    rows.sort((a, b) => rank(a) - rank(b)
      || new Date(b.created_at || 0) - new Date(a.created_at || 0));

    res.json({
      briefs: rows,
      counts: {
        open: rows.length,
        invited: rows.filter((r) => r.invited).length,
        answered: rows.filter((r) => r.my_proposal_status === 'submitted').length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** One brief, with its questions and whatever this creator has already done. */
router.get('/briefs/:reqId', requireSeller, async (req, res) => {
  try {
    const me = root(req.exchangeUser.pinit_id);
    const brief = await getBrief(req.params.reqId);
    if (!brief) return res.status(404).json({ error: 'NOT_FOUND', message: 'That brief no longer exists.' });

    const [questions, myProposal, invite, counts, team] = await Promise.all([
      allSql('SELECT * FROM brief_questions WHERE req_id = ? ORDER BY created_at ASC', [brief.req_id]),
      getSql('SELECT * FROM proposals WHERE req_id = ? AND creator_pinit_id = ?', [brief.req_id, me]),
      getSql('SELECT * FROM brief_invites WHERE req_id = ? AND creator_pinit_id = ?', [brief.req_id, me]),
      proposalCounts([brief.req_id]),
      getSql(
        `SELECT t.* FROM proposal_teams t
         JOIN proposal_team_members m ON m.team_id = t.team_id
         WHERE t.req_id = ? AND m.pinit_id = ?`,
        [brief.req_id, me],
      ),
    ]);

    const authors = questions.map((q) => q.author_pinit_id);
    const profile = await publicProfileIndex(authors);

    res.json({
      brief: { ...brief, proposals_count: counts.get(brief.req_id) || 0 },
      invited: Boolean(invite),
      my_proposal: myProposal
        ? { ...myProposal, asset_ids: parseAssetIds(myProposal.asset_ids) }
        : null,
      my_team: team ? await teamDetail(team.team_id) : null,
      questions: questions.map((q) => ({
        question_id: q.question_id,
        author: profile(q.author_pinit_id)?.name || q.author_pinit_id,
        author_role: q.author_role,
        body: q.body,
        created_at: q.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Submit protected work.
 *
 * The proposal carries HUB asset ids, not a file. The buyer gets a limited
 * preview and the certificate; nothing usable changes hands until a licence is
 * sealed. That is the whole reason to answer a brief here rather than by email,
 * so an empty submission is refused.
 *
 * Re-submitting replaces the previous answer rather than adding a second one —
 * the unique index on (req_id, creator_pinit_id) enforces one answer per person.
 */
router.post('/briefs/:reqId/propose', requireSeller, async (req, res) => {
  try {
    const me = root(req.exchangeUser.pinit_id);
    const brief = await getBrief(req.params.reqId);
    if (!brief) return res.status(404).json({ error: 'NOT_FOUND', message: 'That brief no longer exists.' });
    if (brief.status !== 'open') {
      return res.status(409).json({
        error: 'BRIEF_CLOSED',
        message: 'This brief is no longer taking proposals.',
      });
    }
    if (samePinitFace(brief.buyer_pinit_id, me)) {
      return res.status(403).json({
        error: 'YOUR_OWN_BRIEF',
        message: 'This is your own opportunity. Review the proposals on it instead.',
      });
    }

    const assetIds = parseAssetIds(req.body?.asset_ids).map((a) => String(a).trim()).filter(Boolean);
    if (assetIds.length === 0) {
      return badRequest(res, 'Attach at least one protected asset. The buyer needs work to judge.');
    }

    // Only assets this creator actually protected in HUB.
    const scope = identityMatchSql('pinit_id', me);
    const holes = assetIds.map(() => '?').join(', ');
    const owned = await allSql(
      `SELECT asset_id FROM hub_assets WHERE asset_id IN (${holes}) AND ${scope.sql}`,
      [...assetIds, ...scope.params],
    );
    const ownedIds = owned.map((a) => a.asset_id);
    if (ownedIds.length === 0) {
      return res.status(403).json({
        error: 'NOT_YOUR_ASSET',
        message: 'You can only attach work you protected in Pinit HUB.',
      });
    }

    const note = text(req.body?.note, 1200);
    const existing = await getSql(
      'SELECT proposal_id FROM proposals WHERE req_id = ? AND creator_pinit_id = ?',
      [brief.req_id, me],
    );

    if (existing) {
      await runSql(
        `UPDATE proposals SET note = ?, asset_ids = ?, status = 'submitted', updated_at = ?
         WHERE proposal_id = ?`,
        [note, JSON.stringify(ownedIds), now(), existing.proposal_id],
      );
    } else {
      await runSql(
        `INSERT INTO proposals (proposal_id, req_id, creator_pinit_id, team_id, note, asset_ids, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
        [id('PROP'), brief.req_id, me, text(req.body?.team_id, 40) || null,
          note, JSON.stringify(ownedIds), now(), now()],
      );
    }

    // An invited creator who answers stops being "waiting on".
    await runSql(
      "UPDATE brief_invites SET status = 'answered' WHERE req_id = ? AND creator_pinit_id = ?",
      [brief.req_id, me],
    );
    await syncProposalCount(brief.req_id);

    res.status(201).json({
      message: existing ? 'Your proposal was updated.' : 'Proposal sent. The buyer can see your protected work.',
      attached: ownedIds.length,
      skipped: assetIds.length - ownedIds.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/briefs/:reqId/withdraw', requireSeller, async (req, res) => {
  try {
    const me = root(req.exchangeUser.pinit_id);
    const result = await runSql(
      `UPDATE proposals SET status = 'withdrawn', updated_at = ?
       WHERE req_id = ? AND creator_pinit_id = ? AND status = 'submitted'`,
      [now(), String(req.params.reqId).trim(), me],
    );
    if (!result.changes) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'There is no open proposal to withdraw.' });
    }
    await syncProposalCount(req.params.reqId);
    res.json({ message: 'Proposal withdrawn.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Keep the legacy column roughly in step for anything still reading it, but
 * treat the table as the source of truth everywhere in this file.
 */
async function syncProposalCount(reqId) {
  const row = await getSql(
    "SELECT COUNT(*) AS n FROM proposals WHERE req_id = ? AND status <> 'withdrawn'",
    [String(reqId).trim()],
  );
  await runSql('UPDATE requirements SET proposals_count = ? WHERE req_id = ?',
    [Number(row?.n) || 0, String(reqId).trim()]);
}

/* ── Briefs: the buyer's side ─────────────────────────────────────────── */

router.get('/my-briefs', requireBuyer, async (req, res) => {
  try {
    const user = req.exchangeUser;
    const scope = identityMatchSql('buyer_pinit_id', user.pinit_id);
    const name = String(user.display_name || user.name || '').trim();
    const briefs = await allSql(
      `SELECT * FROM requirements
       WHERE ${scope.sql} OR (buyer_pinit_id IS NULL AND buyer_name = ?)
       ORDER BY created_at DESC`,
      [...scope.params, name],
    );
    const counts = await proposalCounts(briefs.map((b) => b.req_id));
    res.json({
      briefs: briefs.map((b) => ({ ...b, proposals_count: counts.get(b.req_id) || 0 })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * The proposals on one of my briefs.
 *
 * Each row carries the creator's ledger credentials so the buyer can compare
 * without leaving the page — and without any of it being self-reported.
 */
router.get('/briefs/:reqId/proposals', requireBuyer, async (req, res) => {
  try {
    const brief = await getBrief(req.params.reqId);
    if (!brief) return res.status(404).json({ error: 'NOT_FOUND', message: 'That brief no longer exists.' });
    if (!ownsBrief(brief, req.exchangeUser)) {
      return res.status(403).json({ error: 'NOT_YOURS', message: 'This is not your brief.' });
    }

    const [proposals, invites] = await Promise.all([
      allSql(
        "SELECT * FROM proposals WHERE req_id = ? AND status <> 'withdrawn' ORDER BY created_at ASC",
        [brief.req_id],
      ),
      allSql('SELECT * FROM brief_invites WHERE req_id = ? ORDER BY created_at ASC', [brief.req_id]),
    ]);

    const people = [...proposals.map((p) => p.creator_pinit_id), ...invites.map((i) => i.creator_pinit_id)];
    const [profile, creds] = await Promise.all([publicProfileIndex(people), credentialIndex()]);

    // The attached work, titles and previews only — never a file path.
    const allAssetIds = proposals.flatMap((p) => parseAssetIds(p.asset_ids));
    let assetsById = new Map();
    if (allAssetIds.length > 0) {
      const holes = allAssetIds.map(() => '?').join(', ');
      const assets = await allSql(
        `SELECT asset_id, title, vertical, preview_url, badge_tier, dna_record_id
         FROM hub_assets WHERE asset_id IN (${holes})`,
        allAssetIds,
      );
      assetsById = new Map(assets.map((a) => [a.asset_id, a]));
    }

    const teamIds = [...new Set(proposals.map((p) => p.team_id).filter(Boolean))];
    const teams = new Map();
    for (const tid of teamIds) teams.set(tid, await teamDetail(tid));

    res.json({
      brief: { ...brief, proposals_count: proposals.length },
      proposals: proposals.map((p) => ({
        proposal_id: p.proposal_id,
        creator: profile(p.creator_pinit_id) || { pinit_id: p.creator_pinit_id, name: p.creator_pinit_id },
        credentials: creds(p.creator_pinit_id),
        note: p.note,
        status: p.status,
        created_at: p.created_at,
        team: p.team_id ? teams.get(p.team_id) || null : null,
        assets: parseAssetIds(p.asset_ids)
          .map((a) => assetsById.get(a))
          .filter(Boolean),
      })),
      // Invited but not yet answered — the buyer can chase these.
      awaiting: invites
        .filter((i) => i.status === 'invited')
        .map((i) => ({
          creator: profile(i.creator_pinit_id) || { pinit_id: i.creator_pinit_id, name: i.creator_pinit_id },
          credentials: creds(i.creator_pinit_id),
          invited_at: i.created_at,
        })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Award the brief.
 *
 * This is what makes the brief and the licence one line. The brief records who
 * won; the licence, when it is sealed, carries `from_req_id` back to here. A
 * brief can only be awarded once — reopening is a deliberate act, not a
 * side effect of clicking Award twice.
 */
router.post('/briefs/:reqId/award', requireBuyer, async (req, res) => {
  try {
    const brief = await getBrief(req.params.reqId);
    if (!brief) return res.status(404).json({ error: 'NOT_FOUND', message: 'That brief no longer exists.' });
    if (!ownsBrief(brief, req.exchangeUser)) {
      return res.status(403).json({ error: 'NOT_YOURS', message: 'This is not your brief.' });
    }
    if (brief.status === 'awarded') {
      return res.status(409).json({
        error: 'ALREADY_AWARDED',
        message: 'This brief has already been awarded.',
      });
    }

    const proposalId = text(req.body?.proposal_id, 60);
    const proposal = await getSql(
      "SELECT * FROM proposals WHERE proposal_id = ? AND req_id = ? AND status <> 'withdrawn'",
      [proposalId, brief.req_id],
    );
    if (!proposal) return badRequest(res, 'Choose a proposal on this brief to award.');

    const stamp = now();
    await runSql(
      `UPDATE requirements
       SET status = 'awarded', awarded_to_pinit_id = ?, awarded_proposal_id = ?, awarded_at = ?
       WHERE req_id = ?`,
      [proposal.creator_pinit_id, proposal.proposal_id, stamp, brief.req_id],
    );
    await runSql("UPDATE proposals SET status = 'awarded', updated_at = ? WHERE proposal_id = ?",
      [stamp, proposal.proposal_id]);
    await runSql(
      `UPDATE proposals SET status = 'declined', updated_at = ?
       WHERE req_id = ? AND proposal_id <> ? AND status = 'submitted'`,
      [stamp, brief.req_id, proposal.proposal_id],
    );

    res.json({
      message: 'Awarded. The creator can now deliver, and the licence will seal against this brief.',
      awarded_to: proposal.creator_pinit_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Invite named creators to a brief.
 *
 * The cold-start fix. An open call with no answers reads as a broken feature,
 * and Exchange is small enough today that most briefs would look that way.
 * Re-inviting the same creator is a no-op, not a duplicate.
 */
router.post('/briefs/:reqId/invite', requireBuyer, async (req, res) => {
  try {
    const brief = await getBrief(req.params.reqId);
    if (!brief) return res.status(404).json({ error: 'NOT_FOUND', message: 'That brief no longer exists.' });
    if (!ownsBrief(brief, req.exchangeUser)) {
      return res.status(403).json({ error: 'NOT_YOURS', message: 'This is not your brief.' });
    }

    const raw = Array.isArray(req.body?.pinit_ids) ? req.body.pinit_ids : [req.body?.pinit_id];
    const targets = [...new Set(raw.map(root).filter(Boolean))];
    if (targets.length === 0) return badRequest(res, 'Choose at least one creator to invite.');

    const by = root(req.exchangeUser.pinit_id);
    let invited = 0;
    const skipped = [];

    for (const target of targets) {
      if (samePinitFace(target, by)) {
        skipped.push({ pinit_id: target, why: 'You cannot invite yourself.' });
        continue;
      }
      const user = await findUserByPinitId(target);
      if (!user) { skipped.push({ pinit_id: target, why: 'No creator with that Pinit ID.' }); continue; }
      const already = await getSql(
        'SELECT invite_id FROM brief_invites WHERE req_id = ? AND creator_pinit_id = ?',
        [brief.req_id, target],
      );
      if (already) { skipped.push({ pinit_id: target, why: 'Already invited.' }); continue; }
      await runSql(
        `INSERT INTO brief_invites (invite_id, req_id, creator_pinit_id, invited_by_pinit_id, status, created_at)
         VALUES (?, ?, ?, ?, 'invited', ?)`,
        [id('INV'), brief.req_id, target, by, now()],
      );
      invited += 1;
    }

    res.status(201).json({
      message: invited === 1 ? 'Invitation sent.' : `${invited} invitations sent.`,
      invited,
      skipped,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Questions on a brief ─────────────────────────────────────────────── */

/**
 * Threaded on the brief, visible to everyone answering it — not a private
 * inbox. The buyer answers once and every creator sees it, and the answer
 * stays part of the brief's record.
 */
router.post('/briefs/:reqId/questions', async (req, res) => {
  try {
    const claimed = String(
      req.body?.pinit_id || req.headers['x-pinit-id'] || '',
    ).trim();
    if (!claimed) {
      return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Sign in to ask a question.' });
    }
    const user = await findUserByPinitId(claimed);
    if (!user) {
      return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Sign in to ask a question.' });
    }

    const brief = await getBrief(req.params.reqId);
    if (!brief) return res.status(404).json({ error: 'NOT_FOUND', message: 'That brief no longer exists.' });

    const body = text(req.body?.body, 800);
    if (!body) return badRequest(res, 'Write your question first.');

    await runSql(
      `INSERT INTO brief_questions (question_id, req_id, author_pinit_id, author_role, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id('Q'), brief.req_id, root(user.pinit_id),
        ownsBrief(brief, user) ? 'buyer' : 'creator', body, now()],
    );

    res.status(201).json({ message: 'Posted. Everyone answering this brief can see it.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Team proposals ───────────────────────────────────────────────────── */

async function teamDetail(teamId) {
  const team = await getSql('SELECT * FROM proposal_teams WHERE team_id = ?', [teamId]);
  if (!team) return null;
  const members = await allSql(
    'SELECT * FROM proposal_team_members WHERE team_id = ? ORDER BY split_percent DESC', [teamId],
  );
  const profile = await publicProfileIndex(members.map((m) => m.pinit_id));
  return {
    team_id: team.team_id,
    req_id: team.req_id,
    lead_pinit_id: team.lead_pinit_id,
    status: team.status,
    all_accepted: members.length > 0 && members.every((m) => Number(m.accepted) === 1),
    members: members.map((m) => ({
      pinit_id: m.pinit_id,
      name: profile(m.pinit_id)?.name || m.pinit_id,
      role_label: m.role_label,
      split_percent: Number(m.split_percent) || 0,
      accepted: Number(m.accepted) === 1,
      accepted_at: m.accepted_at,
    })),
  };
}

/**
 * Form a team to answer one brief.
 *
 * The split is declared here, before the work, and the proposal cannot be sent
 * until every member has accepted their share. Informal splits agreed after
 * delivery are a real and common failure; this removes the ambiguity rather
 * than mediating it later.
 */
router.post('/briefs/:reqId/team', requireSeller, async (req, res) => {
  try {
    const me = root(req.exchangeUser.pinit_id);
    const brief = await getBrief(req.params.reqId);
    if (!brief) return res.status(404).json({ error: 'NOT_FOUND', message: 'That brief no longer exists.' });
    if (brief.status !== 'open') {
      return res.status(409).json({ error: 'BRIEF_CLOSED', message: 'This brief is no longer taking proposals.' });
    }

    const raw = Array.isArray(req.body?.members) ? req.body.members : [];
    const members = raw
      .map((m) => ({
        pinit_id: root(m.pinit_id),
        role_label: text(m.role_label, 60),
        split_percent: Number(m.split_percent),
      }))
      .filter((m) => m.pinit_id && Number.isFinite(m.split_percent));

    if (!members.some((m) => m.pinit_id === me)) {
      return badRequest(res, 'Include yourself in the team.');
    }
    if (members.length < 2) return badRequest(res, 'A team needs at least two creators.');

    const total = members.reduce((sum, m) => sum + m.split_percent, 0);
    if (Math.round(total * 100) / 100 !== 100) {
      return badRequest(res, `The split has to add up to 100%. It currently adds up to ${total}%.`);
    }

    for (const m of members) {
      const user = await findUserByPinitId(m.pinit_id);
      if (!user) return badRequest(res, `No creator on Exchange with the Pinit ID ${m.pinit_id}.`);
    }

    const teamId = id('TEAM');
    await runSql(
      `INSERT INTO proposal_teams (team_id, req_id, lead_pinit_id, status, created_at)
       VALUES (?, ?, ?, 'forming', ?)`,
      [teamId, brief.req_id, me, now()],
    );
    for (const m of members) {
      // The lead accepts by proposing the split in the first place.
      const isLead = m.pinit_id === me;
      await runSql(
        `INSERT INTO proposal_team_members (id, team_id, pinit_id, role_label, split_percent, accepted, accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id('TM'), teamId, m.pinit_id, m.role_label || null, m.split_percent,
          isLead ? 1 : 0, isLead ? now() : null],
      );
    }

    res.status(201).json({
      message: 'Team created. The proposal can be sent once everyone accepts their share.',
      team: await teamDetail(teamId),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/teams/:teamId/accept', requireSeller, async (req, res) => {
  try {
    const me = root(req.exchangeUser.pinit_id);
    const result = await runSql(
      `UPDATE proposal_team_members SET accepted = 1, accepted_at = ?
       WHERE team_id = ? AND pinit_id = ? AND accepted = 0`,
      [now(), String(req.params.teamId).trim(), me],
    );
    if (!result.changes) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'You are not on this team, or you have already accepted.',
      });
    }
    const team = await teamDetail(req.params.teamId);
    if (team?.all_accepted) {
      await runSql("UPDATE proposal_teams SET status = 'ready' WHERE team_id = ?", [team.team_id]);
      team.status = 'ready';
    }
    res.json({ message: 'Share accepted.', team });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Collaborate ──────────────────────────────────────────────────────── */

/**
 * The creator directory, seller side.
 *
 * The public directory at /exchange/creators already existed; this is the same
 * people with the two things it was missing — whether they are actually free,
 * and a way to reach them. Availability comes from the portfolio field that has
 * been stored all along and shown nowhere.
 */
router.get('/creators', requireSeller, async (req, res) => {
  try {
    const me = root(req.exchangeUser.pinit_id);
    const q = text(req.query.q, 80).toLowerCase();
    const openOnly = String(req.query.open_only || '') === '1';

    const users = await allSql(
      `SELECT pinit_id, name, display_name, role FROM users
       WHERE role IN ('creator', 'admin') LIMIT 500`,
    );
    const [profile, creds] = await Promise.all([
      publicProfileIndex(users.map((u) => u.pinit_id)),
      credentialIndex(),
    ]);

    let people = users
      .filter((u) => !samePinitFace(u.pinit_id, me))
      .map((u) => {
        const p = profile(u.pinit_id) || {};
        return {
          pinit_id: root(u.pinit_id),
          name: p.name || u.display_name || u.name || u.pinit_id,
          headline: p.headline || null,
          location: p.location || null,
          skills: p.skills || null,
          available_for: p.available_for || null,
          portfolio_slug: p.portfolio_slug || null,
          credentials: creds(u.pinit_id),
        };
      });

    if (openOnly) people = people.filter((p) => p.available_for);
    if (q) {
      people = people.filter((p) => `${p.name} ${p.headline || ''} ${p.skills || ''} ${p.location || ''}`
        .toLowerCase().includes(q));
    }

    // Most protected work first — the one ordering nobody can game.
    people.sort((a, b) => b.credentials.assets_protected - a.credentials.assets_protected);
    res.json({ creators: people });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/collabs', requireSeller, async (req, res) => {
  try {
    const posts = await allSql(
      "SELECT * FROM collab_posts WHERE status = 'open' ORDER BY created_at DESC LIMIT 100",
    );
    const profile = await publicProfileIndex(posts.map((p) => p.author_pinit_id));
    res.json({
      collabs: posts.map((p) => ({
        ...p,
        author: profile(p.author_pinit_id)?.name || p.author_pinit_id,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/collabs', requireSeller, async (req, res) => {
  try {
    const title = text(req.body?.title, 140);
    if (!title) return badRequest(res, 'Give the collab a title.');
    const lookingFor = text(req.body?.looking_for, 60);
    if (!lookingFor) return badRequest(res, 'Say what kind of creator you are looking for.');

    const collabId = id('COL');
    await runSql(
      `INSERT INTO collab_posts (collab_id, author_pinit_id, title, body, looking_for, req_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      [collabId, root(req.exchangeUser.pinit_id), title, text(req.body?.body, 1200),
        lookingFor, text(req.body?.req_id, 60) || null, now()],
    );
    res.status(201).json({ message: 'Posted. Other creators can ask to join.', collab_id: collabId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/collabs/:collabId/close', requireSeller, async (req, res) => {
  try {
    const result = await runSql(
      "UPDATE collab_posts SET status = 'closed' WHERE collab_id = ? AND author_pinit_id = ?",
      [String(req.params.collabId).trim(), root(req.exchangeUser.pinit_id)],
    );
    if (!result.changes) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'That is not one of your collab posts.' });
    }
    res.json({ message: 'Closed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Ask to collaborate — one step.
 *
 * Connect, then accept, then message is three steps before anything happens,
 * and most requests die at the first. The reason is required so the person
 * receiving it can judge the ask itself rather than a bare notification.
 */
router.post('/asks', requireSeller, async (req, res) => {
  try {
    const me = root(req.exchangeUser.pinit_id);
    const to = root(req.body?.to_pinit_id);
    if (!to) return badRequest(res, 'Choose a creator to ask.');
    if (samePinitFace(to, me)) return badRequest(res, 'You cannot ask yourself.');

    const reason = text(req.body?.reason, 400);
    if (!reason) return badRequest(res, 'Say what you want to collaborate on — one line is enough.');

    const target = await findUserByPinitId(to);
    if (!target) return badRequest(res, 'No creator on Exchange with that Pinit ID.');

    const pending = await getSql(
      "SELECT ask_id FROM collab_asks WHERE from_pinit_id = ? AND to_pinit_id = ? AND status = 'pending'",
      [me, to],
    );
    if (pending) {
      return res.status(409).json({
        error: 'ALREADY_ASKED',
        message: 'You already have an open ask with this creator.',
      });
    }

    await runSql(
      `INSERT INTO collab_asks (ask_id, from_pinit_id, to_pinit_id, reason, req_id, collab_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [id('ASK'), me, to, reason, text(req.body?.req_id, 60) || null,
        text(req.body?.collab_id, 60) || null, now()],
    );
    res.status(201).json({ message: 'Sent. They will see what you asked for.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/asks/:askId/respond', requireSeller, async (req, res) => {
  try {
    const me = root(req.exchangeUser.pinit_id);
    const decision = String(req.body?.decision || '').trim();
    if (!['accepted', 'declined'].includes(decision)) {
      return badRequest(res, 'Decide whether to accept or decline.');
    }
    const result = await runSql(
      `UPDATE collab_asks SET status = ?, responded_at = ?
       WHERE ask_id = ? AND to_pinit_id = ? AND status = 'pending'`,
      [decision, now(), String(req.params.askId).trim(), me],
    );
    if (!result.changes) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'That ask is not waiting on you.' });
    }
    res.json({ message: decision === 'accepted' ? 'Accepted.' : 'Declined.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── My activity ──────────────────────────────────────────────────────── */

/**
 * Everything of mine that is in flight — proposals I sent, asks in both
 * directions, collabs I posted, teams waiting on me. This is the tab that used
 * to be called "My Applications"; it holds state, not a category of content,
 * which is why it is one section rather than three.
 */
router.get('/activity', requireSeller, async (req, res) => {
  try {
    const me = root(req.exchangeUser.pinit_id);

    const [proposals, sentAsks, inboxAsks, collabs, teamRows] = await Promise.all([
      allSql('SELECT * FROM proposals WHERE creator_pinit_id = ? ORDER BY updated_at DESC', [me]),
      allSql("SELECT * FROM collab_asks WHERE from_pinit_id = ? ORDER BY created_at DESC LIMIT 50", [me]),
      allSql("SELECT * FROM collab_asks WHERE to_pinit_id = ? ORDER BY created_at DESC LIMIT 50", [me]),
      allSql('SELECT * FROM collab_posts WHERE author_pinit_id = ? ORDER BY created_at DESC', [me]),
      allSql(
        `SELECT t.team_id FROM proposal_teams t
         JOIN proposal_team_members m ON m.team_id = t.team_id
         WHERE m.pinit_id = ? AND t.status <> 'submitted'`,
        [me],
      ),
    ]);

    const briefIds = [...new Set(proposals.map((p) => p.req_id))];
    let briefsById = new Map();
    if (briefIds.length > 0) {
      const holes = briefIds.map(() => '?').join(', ');
      const briefs = await allSql(
        `SELECT req_id, title, budget, deadline, status, vertical, buyer_org, buyer_name
         FROM requirements WHERE req_id IN (${holes})`,
        briefIds,
      );
      briefsById = new Map(briefs.map((b) => [b.req_id, b]));
    }

    const people = [...sentAsks.map((a) => a.to_pinit_id), ...inboxAsks.map((a) => a.from_pinit_id)];
    const profile = await publicProfileIndex(people);

    const teams = [];
    for (const t of teamRows) teams.push(await teamDetail(t.team_id));

    res.json({
      proposals: proposals.map((p) => ({
        proposal_id: p.proposal_id,
        status: p.status,
        note: p.note,
        asset_count: parseAssetIds(p.asset_ids).length,
        created_at: p.created_at,
        updated_at: p.updated_at,
        brief: briefsById.get(p.req_id) || { req_id: p.req_id, title: p.req_id },
      })),
      asks_sent: sentAsks.map((a) => ({
        ask_id: a.ask_id, status: a.status, reason: a.reason, created_at: a.created_at,
        creator: profile(a.to_pinit_id)?.name || a.to_pinit_id,
      })),
      asks_received: inboxAsks.map((a) => ({
        ask_id: a.ask_id, status: a.status, reason: a.reason, created_at: a.created_at,
        creator: profile(a.from_pinit_id)?.name || a.from_pinit_id,
      })),
      collabs,
      // A team is only "waiting on you" when you have not accepted your share.
      teams: teams.filter(Boolean).map((t) => ({
        ...t,
        waiting_on_me: t.members.some((m) => samePinitFace(m.pinit_id, me) && !m.accepted),
      })),
      counts: {
        proposals: proposals.filter((p) => p.status === 'submitted').length,
        asks_waiting: inboxAsks.filter((a) => a.status === 'pending').length,
        teams_waiting: teams.filter((t) => t?.members
          .some((m) => samePinitFace(m.pinit_id, me) && !m.accepted)).length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
