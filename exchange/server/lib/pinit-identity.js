/**
 * One face → one code. Account type is only the prefix.
 * Individual: PINIT-USER-{CODE}
 * Business:   PINIT-ORG-{CODE}
 * Exchange:   PINIT-EX-{CODE}
 */

const CODE_RE = /^[A-Z0-9]{6,12}$/;

export function extractPinitCode(shortId) {
  if (!shortId) return '';
  const raw = String(shortId).trim().toUpperCase();
  if (!raw) return '';

  const prefixed = raw.match(/^PINIT-(?:USER|ORG|WS|EX)-([A-Z0-9]+)$/);
  if (prefixed?.[1] && CODE_RE.test(prefixed[1])) return prefixed[1];

  const root = raw.match(/^PINIT-([A-Z0-9]+)$/);
  if (root?.[1] && CODE_RE.test(root[1])) return root[1];

  const parts = raw.split('-').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return CODE_RE.test(last) ? last : last;
}

export function toRootPinitId(shortIdOrCode) {
  const code = extractPinitCode(shortIdOrCode);
  return code ? `PINIT-${code}` : '';
}

export function toUserPinitId(shortIdOrCode) {
  const code = extractPinitCode(shortIdOrCode);
  return code ? `PINIT-USER-${code}` : '';
}

export function toExchangePinitId(shortIdOrCode) {
  const code = extractPinitCode(shortIdOrCode);
  return code ? `PINIT-EX-${code}` : '';
}

export function identityCandidates(shortIdOrCode) {
  const code = extractPinitCode(shortIdOrCode);
  if (!code) return [];
  return [
    `PINIT-EX-${code}`,
    `PINIT-${code}`,
    `PINIT-USER-${code}`,
    `PINIT-ORG-${code}`,
  ];
}

/** SQL expression that yields the shared face code (M58CDMZU) from any prefix. */
export function pinitCodeExpr(column) {
  return `REPLACE(REPLACE(REPLACE(REPLACE(UPPER(${column}), 'PINIT-EX-', ''), 'PINIT-USER-', ''), 'PINIT-ORG-', ''), 'PINIT-', '')`;
}

/** Join listings → the Exchange user for the same face, not an exact prefix match. */
export function listingUserJoinSql(listingAlias = 'l', userAlias = 'u') {
  return `${userAlias}.pinit_id = (
    SELECT u2.pinit_id FROM users u2
    WHERE ${pinitCodeExpr('u2.pinit_id')} = ${pinitCodeExpr(`${listingAlias}.pinit_id`)}
    ORDER BY CASE WHEN u2.pinit_id LIKE 'PINIT-EX-%' THEN 0 ELSE 1 END
    LIMIT 1
  )`;
}

export function sellerMatchClause(column, sellerId) {
  const id = String(sellerId || '').trim();
  const code = extractPinitCode(id);
  if (code) {
    return { sql: ` AND ${pinitCodeExpr(column)} = ?`, params: [code] };
  }
  return { sql: ` AND ${column} = ?`, params: [id] };
}

/** Same face code across PINIT-EX / PINIT-USER / PINIT-ORG / PINIT- prefixes. */
export function identityMatchSql(column, pinitId) {
  const id = String(pinitId || '').trim();
  const code = extractPinitCode(id);
  if (code) {
    return { sql: `${pinitCodeExpr(column)} = ?`, params: [code] };
  }
  return { sql: `${column} = ?`, params: [id] };
}

export function samePinitFace(a, b) {
  const ca = extractPinitCode(a);
  const cb = extractPinitCode(b);
  if (ca && cb) return ca === cb;
  return Boolean(a) && String(a).trim() === String(b || '').trim();
}
