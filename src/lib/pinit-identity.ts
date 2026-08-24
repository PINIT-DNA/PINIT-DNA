/**
 * Shared PINIT identity codes — one face → one account code.
 *
 * Root biometric account:  PINIT-{CODE}
 * Individual mode label:   PINIT-USER-{CODE}
 * Business / org label:    PINIT-ORG-{CODE}
 * Exchange account:        PINIT-EX-{CODE}
 *
 * CODE is the same 8-char suffix for every account type of the same face.
 */

const CODE_RE = /^[A-Z0-9]{6,12}$/;

/** Extract the shared code from any PINIT / PINIT-USER / PINIT-ORG / PINIT-WS / PINIT-EX id. */
export function extractPinitCode(shortId: string | null | undefined): string {
  if (!shortId) return '';
  const raw = shortId.trim().toUpperCase();
  if (!raw) return '';

  // PINIT-USER-XXXXXXXX / PINIT-ORG-XXXXXXXX / PINIT-WS-XXXXXX / PINIT-EX-XXXXXXXX
  const prefixed = raw.match(/^PINIT-(?:USER|ORG|WS|EX)-([A-Z0-9]+)$/);
  if (prefixed?.[1] && CODE_RE.test(prefixed[1])) return prefixed[1];

  // PINIT-XXXXXXXX (root biometric id)
  const root = raw.match(/^PINIT-([A-Z0-9]+)$/);
  if (root?.[1] && CODE_RE.test(root[1])) return root[1];

  // Fallback: last segment
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

export function toExchangePinitId(shortIdOrCode: string | null | undefined): string {
  const code = extractPinitCode(shortIdOrCode);
  return code ? `PINIT-EX-${code}` : '';
}

/** Mode-aware label for UI (Individual vs Business shell). */
export function displayPinitIdForMode(
  rootShortId: string | null | undefined,
  mode: 'INDIVIDUAL' | 'BUSINESS',
): string {
  return mode === 'BUSINESS' ? toOrgPinitId(rootShortId) : toUserPinitId(rootShortId);
}
