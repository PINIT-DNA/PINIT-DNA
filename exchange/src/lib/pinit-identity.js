/** One face → one code. Prefixes (USER / ORG / EX) are account type only. */

export function extractPinitCode(shortId) {
  if (!shortId) return '';
  const raw = String(shortId).trim().toUpperCase();
  const prefixed = raw.match(/^PINIT-(?:USER|ORG|WS|EX)-([A-Z0-9]+)$/);
  if (prefixed?.[1]) return prefixed[1];
  const root = raw.match(/^PINIT-([A-Z0-9]+)$/);
  if (root?.[1]) return root[1];
  const last = raw.split('-').filter(Boolean).pop() || '';
  return last;
}

export function samePinitIdentity(a, b) {
  if (!a || !b) return false;
  return extractPinitCode(a) === extractPinitCode(b);
}
