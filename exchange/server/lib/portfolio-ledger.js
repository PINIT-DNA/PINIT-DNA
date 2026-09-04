/**
 * The verified ledger — the one page on a Pinit portfolio no competitor can build.
 *
 * Every other portfolio product shows work someone *says* is theirs. This reads
 * the record: each asset was fingerprinted, dated and sealed in HUB before it
 * was ever published, so the protection date is the claim. It says the file
 * existed before the portfolio page did.
 *
 * Deliberately a separate module rather than more code inside portfolio.js —
 * that file is being actively edited, and this needs to merge cleanly.
 *
 * Nothing here is editable by the person it describes. Everything is counted
 * from tables they cannot write to directly, which is the same rule the creator
 * credentials on Opportunities follow.
 */
import { allSql } from './db.js';
import { identityMatchSql } from './pinit-identity.js';

/** Columns safe to publish. A file path or storage key must never appear. */
const LEDGER_FIELDS = [
  'asset_id', 'title', 'vertical', 'file_type', 'badge_tier',
  'human_percent', 'ai_percent', 'dna_record_id', 'created_at',
];

/**
 * A DNA record id is a real identifier, so it is shown — but truncated. A
 * visitor should be able to see that a record exists and check it, without the
 * page becoming a dump of full hashes nobody reads.
 */
function shortHash(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.length <= 12 ? s : `${s.slice(0, 10)}…`;
}

function toEntry(row) {
  return {
    asset_id: row.asset_id,
    // The certificate reference a visitor can quote back to us. It is the
    // asset's real id, not a decorative number.
    certificate: row.asset_id,
    title: row.title || 'Untitled',
    vertical: row.vertical || '',
    file_type: row.file_type || '',
    badge_tier: row.badge_tier || '',
    // human_percent is already on every asset. Showing it is a stance: in a year
    // when every client quietly wonders what was generated, hiding it would
    // eventually read as an answer.
    human_percent: Number.isFinite(Number(row.human_percent)) ? Number(row.human_percent) : null,
    ai_percent: Number.isFinite(Number(row.ai_percent)) ? Number(row.ai_percent) : null,
    dna: shortHash(row.dna_record_id),
    protected_at: row.created_at || null,
  };
}

/**
 * The sealed ledger for one creator, newest first.
 *
 * `limit` caps what the public page renders; `total` is the honest count, so a
 * portfolio with 400 assets says 400 rather than the 200 it drew.
 */
export async function loadVerifiedLedger(pinitId, { limit = 200 } = {}) {
  const scope = identityMatchSql('pinit_id', pinitId);
  if (!scope.params.length) return emptyLedger();

  let rows = [];
  try {
    rows = await allSql(
      `SELECT ${LEDGER_FIELDS.join(', ')} FROM hub_assets
       WHERE ${scope.sql}
       ORDER BY created_at DESC
       LIMIT ${Math.max(1, Math.min(1000, Number(limit) || 200))}`,
      scope.params,
    );
  } catch {
    // A portfolio whose ledger cannot be read is still worth serving. The page
    // hides the section rather than showing a broken one.
    return emptyLedger();
  }

  const entries = rows.map(toEntry);

  const totalRow = await allSql(
    `SELECT COUNT(*) AS n FROM hub_assets WHERE ${scope.sql}`, scope.params,
  ).catch(() => []);
  const total = Number(totalRow?.[0]?.n) || entries.length;

  return {
    total,
    shown: entries.length,
    entries,
    summary: summarise(entries, total),
  };
}

function emptyLedger() {
  return { total: 0, shown: 0, entries: [], summary: summarise([], 0) };
}

/**
 * The counted stats under the name.
 *
 * `since` is the year of the earliest protected asset — a portfolio stat that
 * cannot be inflated, unlike "8 years experience" typed into a bio.
 */
function summarise(entries, total) {
  const years = entries
    .map((e) => (e.protected_at ? new Date(e.protected_at).getFullYear() : null))
    .filter((y) => Number.isFinite(y) && y > 1990);

  const humanValues = entries.map((e) => e.human_percent).filter((n) => Number.isFinite(n));

  return {
    assets_protected: total,
    since: years.length ? Math.min(...years) : null,
    latest: entries[0]?.protected_at || null,
    // An average is only meaningful once there is something to average.
    avg_human_percent: humanValues.length
      ? Math.round(humanValues.reduce((a, b) => a + b, 0) / humanValues.length)
      : null,
    tiers: entries.reduce((acc, e) => {
      if (!e.badge_tier) return acc;
      acc[e.badge_tier] = (acc[e.badge_tier] || 0) + 1;
      return acc;
    }, {}),
  };
}

/**
 * Assets protected per year, oldest first — the Timeline section.
 *
 * It fills itself and it is a visible record of showing up, which is worth more
 * on a portfolio than another paragraph about passion.
 */
export function ledgerTimeline(ledger) {
  const byYear = new Map();
  for (const entry of ledger?.entries || []) {
    if (!entry.protected_at) continue;
    const y = new Date(entry.protected_at).getFullYear();
    if (!Number.isFinite(y) || y < 1990) continue;
    byYear.set(y, (byYear.get(y) || 0) + 1);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({ year, count }));
}
