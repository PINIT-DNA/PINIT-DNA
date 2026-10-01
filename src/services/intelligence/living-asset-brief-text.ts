function punctuate(line: string): string {
  const s = line.slice(0, 220).trim();
  if (!s) return s;
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** Redact ID-like tokens, not ordinary ALL-CAPS headings (SOCIAL, MARKETING, …). */
export function redactSensitiveTokens(text: string): string {
  return text
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[number]')
    .replace(/\b\d{8,}\b/g, '[number]')
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[id]')
    .replace(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,}\b/g, '[id]')
    .replace(/[A-Z0-9<]{20,}/g, '[code]');
}

export function looksLikeShreddedBrief(text: string): boolean {
  const ids = (text.match(/\[id\]/gi) || []).length;
  const numbers = (text.match(/\[number\]/gi) || []).length;
  return ids + numbers >= 3;
}

/** Prefer readable sentences over title-case heading soup. */
export function readableExcerpt(text: string, maxChars = 4000): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const sentences = compact.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const good = sentences.filter((s) => {
    const words = s.split(/\s+/).length;
    const hasLower = /[a-z]/.test(s);
    return words >= 8 && (hasLower || words >= 12);
  });
  const pick = (good.length ? good : sentences).slice(0, 8).join(' ');
  return pick.slice(0, maxChars);
}

/** Exactly two spoken lines. Extra sentences are dropped. */
export function twoLines(raw: string, fallback1: string, fallback2: string): [string, string] {
  const clean = raw.replace(/\s+/g, ' ').replace(/[*#_`]/g, '').trim();
  const parts = clean.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return [punctuate(parts[0] || fallback1), punctuate(parts[1] || fallback2)];
}
