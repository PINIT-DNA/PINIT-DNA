/** Text normalisation shared by every adapter. Pure functions, no I/O. */

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Parses the date formats printed on Indian and ICAO documents.
 * Day-first is assumed for numeric dates (dd/mm/yyyy), as on Indian IDs.
 */
export function parseDate(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{4})$/);
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!);
  m = s.match(/^(\d{1,2})[-/.\s]([A-Z]{3,4})[-/.\s,]*(\d{4})$/);
  if (m && MONTHS[m[2]!]) return iso(+m[3]!, MONTHS[m[2]!]!, +m[1]!);
  return null;
}

/** ICAO YYMMDD. Birth dates roll back a century when they would be in the future. */
export function parseMrzDate(yymmdd: string, kind: 'birth' | 'expiry', now = new Date()): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = +yymmdd.slice(0, 2);
  const mm = +yymmdd.slice(2, 4);
  const dd = +yymmdd.slice(4, 6);
  const currentYY = now.getUTCFullYear() % 100;
  const century = kind === 'birth' ? (yy > currentYY ? 1900 : 2000) : 2000;
  return iso(century + yy, mm, dd);
}

/** All date-looking substrings in order of appearance, as ISO strings. */
export function findDates(text: string): string[] {
  const out: string[] = [];
  const re = /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-\s][A-Za-z]{3,4}[-\s,]*\d{4})\b/g;
  for (const match of text.matchAll(re)) {
    const parsed = parseDate(match[1]);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function normalizeName(raw: string | null | undefined): string {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(raw: string | null | undefined): string[] {
  return normalizeName(raw).split(' ').filter(Boolean);
}

export function normalizeGender(raw: string | null | undefined): 'M' | 'F' | 'X' | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return null;
  if (/^(M|MALE|पुरुष)$/.test(s)) return 'M';
  if (/^(F|FEMALE|महिला)$/.test(s)) return 'F';
  if (/^(X|T|TG|TRANSGENDER|OTHER|<)$/.test(s)) return 'X';
  return null;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Collapses OCR whitespace (including non-breaking spaces) into single spaces. */
export function cleanText(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export function ageOn(dobIso: string, on: Date): number | null {
  const dob = new Date(`${dobIso}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = on.getUTCMonth() < dob.getUTCMonth()
    || (on.getUTCMonth() === dob.getUTCMonth() && on.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}
