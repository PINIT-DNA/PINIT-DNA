/**
 * Strip Pinit protection tails from HTML for display only.
 * Manifests remain in the real vault/download bytes for tracking.
 */
export function stripPinitProtectionTailsForDisplay(html: string): string {
  return html
    // HTML comment form (new embeds)
    .replace(/<!--\s*PINIT-MANIFEST:[\s\S]*?:END-MANIFEST\s*-->/gi, '')
    .replace(/<!--\s*TEP-MANIFEST:[\s\S]*?:END-TEP-MANIFEST\s*-->/gi, '')
    // Binary / visible tails (older embeds — null bytes may appear as empty)
    .replace(/\u0000?PINIT-MANIFEST:[\s\S]*?:END-MANIFEST\u0000?/gi, '')
    .replace(/\u0000?TEP-MANIFEST:[\s\S]*?:END-TEP-MANIFEST\u0000?/gi, '')
    .replace(/\s+$/u, '');
}
