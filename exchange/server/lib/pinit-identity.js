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
