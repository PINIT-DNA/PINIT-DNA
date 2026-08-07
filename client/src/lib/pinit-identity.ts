/**
 * Client mirror of server `src/lib/pinit-identity.ts`.
 * One face → one code; USER vs ORG prefix only.
 */

const CODE_RE = /^[A-Z0-9]{6,12}$/;

export function extractPinitCode(shortId: string | null | undefined): string {
  if (!shortId) return '';
  const raw = shortId.trim().toUpperCase();
  if (!raw) return '';

  const prefixed = raw.match(/^PINIT-(?:USER|ORG|WS)-([A-Z0-9]+)$/);
  if (prefixed?.[1] && CODE_RE.test(prefixed[1])) return prefixed[1];

  const root = raw.match(/^PINIT-([A-Z0-9]+)$/);
  if (root?.[1] && CODE_RE.test(root[1])) return root[1];

  const parts = raw.split('-').filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return CODE_RE.test(last) ? last : last;
}

export function toRootPinitId(shortIdOrCode: string | null | undefined): string {
  const code = extractPinitCode(shortIdOrCode);
  return code ? `PINIT-${code}` : '';
}

export function toUserPinitId(shortIdOrCode: string | null | undefined): string {
  const code = extractPinitCode(shortIdOrCode);
  return code ? `PINIT-USER-${code}` : '';
}

export function toOrgPinitId(shortIdOrCode: string | null | undefined): string {
  const code = extractPinitCode(shortIdOrCode);
  return code ? `PINIT-ORG-${code}` : '';
}

export function displayPinitIdForMode(
  rootShortId: string | null | undefined,
  mode: 'INDIVIDUAL' | 'BUSINESS',
): string {
  return mode === 'BUSINESS' ? toOrgPinitId(rootShortId) : toUserPinitId(rootShortId);
}
