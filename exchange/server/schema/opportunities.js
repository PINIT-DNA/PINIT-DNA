/**
 * Opportunities schema — briefs, proposals, invites, questions, collabs, teams.
 *
 * Written once and applied to both drivers. The Exchange runs on SQLite by
 * default and Postgres when EXCHANGE_DATABASE_URL is set, and the two schemas
 * are otherwise maintained in separate files — which is how `requirements`
 * ended up with a column on one side and not the other. Everything here is
 * additive and idempotent, so it is safe on every boot.
 *
 * The only real dialect difference in these tables is the timestamp type, so
 * that is the only thing translated.
 */

/**
 * Why a proposal is a row and not a counter:
 *
 * `POST /api/requirements/:id/propose` used to run one statement —
 * `UPDATE requirements SET proposals_count = proposals_count + 1`. The creator
 * submitted, the buyer's card ticked up by one, and neither could find the
 * other afterwards. Every part of Opportunities that follows a submission
 * (review, award, the licence sealed against the brief) needs the row this
 * table stores. `proposals_count` is now derived from here rather than kept.
 */
const TABLES = [
  `CREATE TABLE IF NOT EXISTS proposals (
    proposal_id TEXT PRIMARY KEY,
    req_id TEXT NOT NULL,
    creator_pinit_id TEXT NOT NULL,
    team_id TEXT,
    note TEXT,
    asset_ids TEXT,
    status TEXT NOT NULL DEFAULT 'submitted',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  /**
   * A buyer inviting named creators to a brief.
   *
   * This is the cold-start fix: an open call with no answers reads as broken,
   * and Exchange is small enough today that most briefs would look that way.
   * An invited brief always has someone in it.
   */
  `CREATE TABLE IF NOT EXISTS brief_invites (
    invite_id TEXT PRIMARY KEY,
    req_id TEXT NOT NULL,
    creator_pinit_id TEXT NOT NULL,
    invited_by_pinit_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'invited',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  /**
   * Questions live on the brief, not in a private inbox.
   *
   * Everyone answering the brief sees the buyer's reply, so the same question
   * is not asked five times and the answer stays part of the record. This is
   * deliberately not a messaging system.
   */
  `CREATE TABLE IF NOT EXISTS brief_questions (
    question_id TEXT PRIMARY KEY,
    req_id TEXT NOT NULL,
    author_pinit_id TEXT NOT NULL,
    author_role TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  /** A creator looking for a partner — the other object under Opportunities. */
  `CREATE TABLE IF NOT EXISTS collab_posts (
    collab_id TEXT PRIMARY KEY,
    author_pinit_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    looking_for TEXT,
    req_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  /**
   * "Ask to collaborate" — one step, not connect-then-accept-then-message.
   *
   * `reason` is NOT NULL on purpose: a bare connection request gives the
   * recipient nothing to judge, and three steps before anything happens is
   * where most of these die.
   */
  `CREATE TABLE IF NOT EXISTS collab_asks (
    ask_id TEXT PRIMARY KEY,
    from_pinit_id TEXT NOT NULL,
    to_pinit_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    req_id TEXT,
    collab_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    responded_at DATETIME
  )`,

  /**
   * Two creators answering one brief, with the fee split agreed before the
   * work rather than argued about after it. The proposal cannot be sent until
   * every member has accepted their share.
   */
  `CREATE TABLE IF NOT EXISTS proposal_teams (
    team_id TEXT PRIMARY KEY,
    req_id TEXT NOT NULL,
    lead_pinit_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'forming',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS proposal_team_members (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    pinit_id TEXT NOT NULL,
    role_label TEXT,
    split_percent REAL NOT NULL DEFAULT 0,
    accepted INTEGER NOT NULL DEFAULT 0,
    accepted_at DATETIME
  )`,
];

const INDEXES = [
  // One creator answers a brief once. A second submit updates that row.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_proposals_req_creator
     ON proposals (req_id, creator_pinit_id)`,
  `CREATE INDEX IF NOT EXISTS idx_proposals_req ON proposals (req_id)`,
  `CREATE INDEX IF NOT EXISTS idx_proposals_creator ON proposals (creator_pinit_id)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_brief_invites_req_creator
     ON brief_invites (req_id, creator_pinit_id)`,
  `CREATE INDEX IF NOT EXISTS idx_brief_invites_creator ON brief_invites (creator_pinit_id)`,

  `CREATE INDEX IF NOT EXISTS idx_brief_questions_req ON brief_questions (req_id)`,

  `CREATE INDEX IF NOT EXISTS idx_collab_posts_status ON collab_posts (status)`,
  `CREATE INDEX IF NOT EXISTS idx_collab_posts_author ON collab_posts (author_pinit_id)`,

  `CREATE INDEX IF NOT EXISTS idx_collab_asks_to ON collab_asks (to_pinit_id)`,
  `CREATE INDEX IF NOT EXISTS idx_collab_asks_from ON collab_asks (from_pinit_id)`,

  `CREATE INDEX IF NOT EXISTS idx_proposal_teams_req ON proposal_teams (req_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_team_pinit
     ON proposal_team_members (team_id, pinit_id)`,
];

/**
 * Columns added to tables that already exist.
 *
 * `from_req_id` on the seal is the one that matters: it is what turns a brief
 * and a licence into a single line — posted, proposals, awarded, sealed,
 * certificate — instead of two records that never reference each other.
 */
const ALTERS = [
  ['requirements', 'awarded_to_pinit_id', 'TEXT'],
  ['requirements', 'awarded_proposal_id', 'TEXT'],
  ['requirements', 'awarded_at', 'DATETIME'],
  ['requirements', 'closed_at', 'DATETIME'],
  ['requirements', 'creators_needed', 'INTEGER DEFAULT 1'],
  ['orders_sealed', 'from_req_id', 'TEXT'],
];

/** SQLite writes DATETIME; Postgres has no such type. */
function forDriver(sql, driver) {
  if (driver !== 'postgres') return sql;
  return sql.replace(/\bDATETIME\b/g, 'TIMESTAMPTZ');
}

/** CREATE TABLE + CREATE INDEX statements, in dependency-free order. */
export function opportunityCreates(driver) {
  return [...TABLES, ...INDEXES].map((sql) => forDriver(sql, driver));
}

/**
 * ALTER statements. SQLite has no `IF NOT EXISTS` for columns, so those are
 * expected to fail with "duplicate column" on every boot after the first and
 * the caller ignores that — the same convention applyTrustHardeningSchema
 * already uses. Postgres gets the guarded form.
 */
export function opportunityAlters(driver) {
  return ALTERS.map(([table, column, type]) => {
    const t = forDriver(type, driver);
    return driver === 'postgres'
      ? `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${t}`
      : `ALTER TABLE ${table} ADD COLUMN ${column} ${t}`;
  });
}
