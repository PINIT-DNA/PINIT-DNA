/**
 * Published checksum and structure rules. A passing checksum means the number
 * is well-formed — not that it was issued or that it belongs to this person.
 */

// ── Verhoeff (used by Aadhaar's last digit) ──────────────────────────────────
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const rev = digits.split('').reverse();
  for (let i = 0; i < rev.length; i++) {
    c = D[c]![P[i % 8]![+rev[i]!]!]!;
  }
  return c === 0;
}

/** Appends the Verhoeff check digit (used by tests to build valid sample numbers). */
export function verhoeffCheckDigit(digits: string): string {
  const inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];
  let c = 0;
  const rev = digits.split('').reverse();
  for (let i = 0; i < rev.length; i++) {
    c = D[c]![P[(i + 1) % 8]![+rev[i]!]!]!;
  }
  return String(inv[c]);
}

/** Aadhaar: 12 digits, cannot start with 0 or 1, Verhoeff-valid. */
export function isValidAadhaarNumber(raw: string): boolean {
  const n = raw.replace(/\s/g, '');
  return /^[2-9]\d{11}$/.test(n) && verhoeffValid(n);
}

// ── ICAO 9303 check digits (passport MRZ) ────────────────────────────────────
function icaoValue(ch: string): number {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55;
  return 0; // '<' filler
}

export function icaoCheckDigit(field: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += icaoValue(field[i]!) * weights[i % 3]!;
  return sum % 10;
}

export function icaoValid(field: string, check: string): boolean {
  if (check === '<') return /^<*$/.test(field);
  return /^\d$/.test(check) && icaoCheckDigit(field) === +check;
}

// ── Structure rules ──────────────────────────────────────────────────────────

/** PAN: 5 letters, 4 digits, 1 letter. 4th letter = holder type. */
export const PAN_PATTERN = /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/;
export const PAN_HOLDER_TYPES: Record<string, string> = {
  P: 'Individual', C: 'Company', H: 'Hindu Undivided Family', F: 'Firm', A: 'Association of Persons',
  T: 'Trust', B: 'Body of Individuals', L: 'Local Authority', J: 'Artificial Juridical Person', G: 'Government',
};

/** EPIC (Voter ID): 3 letters + 7 digits. */
export const EPIC_PATTERN = /^[A-Z]{3}\d{7}$/;

/** Indian state/UT codes used as the first two letters of a driving licence number. */
export const INDIAN_STATE_CODES = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'DN', 'GA', 'GJ', 'HP', 'HR', 'JH', 'JK', 'KA', 'KL',
  'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ', 'NL', 'OD', 'OR', 'PB', 'PY', 'RJ', 'SK', 'TN', 'TR', 'TS', 'UK',
  'UA', 'UP', 'WB',
]);

/** Driving licence: SS RR YYYY NNNNNNN (15 chars without separators). */
export function parseIndianDlNumber(raw: string): { state: string; rto: string; year: number; serial: string } | null {
  const n = raw.toUpperCase().replace(/[\s-]/g, '');
  const m = n.match(/^([A-Z]{2})(\d{2})(\d{4})(\d{7})$/);
  if (!m) return null;
  return { state: m[1]!, rto: m[2]!, year: +m[3]!, serial: m[4]! };
}
