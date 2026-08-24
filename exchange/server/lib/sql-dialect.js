/**
 * Translate SQLite-oriented SQL to Postgres-compatible SQL.
 * Keeps route handlers mostly unchanged.
 */
export function sqliteSqlToPostgres(sql) {
  let s = String(sql).trim();

  s = s.replace(/BEGIN\s+IMMEDIATE/gi, 'BEGIN');

  // A caller may already have appended RETURNING (see the postgres driver's
  // run(), which does so before translation). Postgres requires ON CONFLICT to
  // come BEFORE RETURNING, so split any trailing RETURNING off, rewrite the
  // statement, then put it back last. Without this the conflict clause lands
  // after RETURNING and Postgres rejects it with: syntax error at or near "ON".
  let returning = '';
  const retMatch = s.match(/\s+(RETURNING\s+[\s\S]+?)\s*;?\s*$/i);
  if (retMatch) {
    returning = ` ${retMatch[1].trim()}`;
    s = s.slice(0, retMatch.index).trim();
  }

  // INSERT OR IGNORE INTO t ... → INSERT INTO t ... ON CONFLICT DO NOTHING
  if (/^INSERT\s+OR\s+IGNORE\s+INTO/i.test(s) && !/ON\s+CONFLICT/i.test(s)) {
    s = s.replace(/^INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
    s = s.replace(/;?\s*$/, '') + ' ON CONFLICT DO NOTHING';
  }

  // INSERT OR REPLACE INTO t (cols) VALUES (...) → upsert on first column (PK convention)
  if (/^INSERT\s+OR\s+REPLACE\s+INTO/i.test(s) && !/ON\s+CONFLICT/i.test(s)) {
    const m = s.match(
      /^INSERT\s+OR\s+REPLACE\s+INTO\s+([a-zA-Z0-9_.]+)\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*)\)\s*;?\s*$/i
    );
    if (m) {
      const table = m[1];
      const cols = m[2].split(',').map((c) => c.trim()).filter(Boolean);
      const values = m[3];
      const pk = cols[0];
      const updates = cols
        .slice(1)
        .map((c) => `${c} = EXCLUDED.${c}`)
        .join(', ');
      if (updates) {
        s = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values}) ON CONFLICT (${pk}) DO UPDATE SET ${updates}`;
      } else {
        s = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values}) ON CONFLICT (${pk}) DO NOTHING`;
      }
    }
  }

  // SQLite excluded. → Postgres EXCLUDED. (case-insensitive already; keep as-is)

  return s + returning;
}

/** Convert ? placeholders to $1, $2, ... for node-pg */
export function qmarkToDollar(sql) {
  let i = 0;
  return String(sql).replace(/\?/g, () => `$${++i}`);
}
