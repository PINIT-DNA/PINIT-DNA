/**
 * Normalize browser-declared MIME types (e.g. video/webm;codecs=vp9,opus).
 */
export function normalizeMimeType(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return base;
}

export function mimeMatchesAllowed(declared: string, allowed: string[]): boolean {
  const base = normalizeMimeType(declared);
  return allowed.includes(base) || allowed.includes(declared);
}
