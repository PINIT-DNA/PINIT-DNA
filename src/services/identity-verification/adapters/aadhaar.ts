/**
 * Aadhaar (UIDAI). Front: name, DOB or year of birth, gender, 12-digit number.
 * Back: address. The number's last digit is a Verhoeff checksum. A masked
 * Aadhaar (XXXX XXXX 1234) cannot be checksummed and is reported as such.
 */
import type { ExtractedField, ExtractedFields, Finding, OcrToken } from '../types';
import { isValidAadhaarNumber } from '../checksums';
import { cleanText, parseDate } from '../normalize';
import { dateAfter, field, genderIn, missingRequired, scoreFeatures, type DocumentAdapter } from './adapter';
import { dateFindings } from './rules';

const FULL_NUMBER = /\b([2-9]\d{3})\s?(\d{4})\s?(\d{4})\b/;
const MASKED_NUMBER = /\b[Xx*]{4}\s?[Xx*]{4}\s?(\d{4})\b/;
const VID = /\bVID\s*[:]?\s*(\d{4}\s?\d{4}\s?\d{4}\s?\d{4})\b/i;
const NAME_SKIP = new Set([
  'government', 'of', 'india', 'aadhaar', 'aadhar', 'uidai', 'unique', 'identification', 'authority',
  'male', 'female', 'year', 'birth', 'dob', 'date', 'to', 'the', 'card', 'india',
]);

/** A printed name word: Title Case or ALL CAPS. Drops logo noise such as "efigH" and "DE". */
function isNameWord(w: string): boolean {
  if (w.length < 3 || NAME_SKIP.has(w.toLowerCase())) return false;
  return /^[A-Z][a-z]+$/.test(w) || /^[A-Z]{3,}$/.test(w);
}

function nameWords(raw: string): string[] {
  return raw.split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, '')).filter(isNameWord);
}

interface OcrLine { y: number; text: string; words: Array<{ text: string; confidence: number }> }

/** Words on the same horizontal band are one printed line. */
function linesFromTokens(tokens: OcrToken[]): OcrLine[] {
  const sorted = tokens.filter((t) => t.text.trim()).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines: OcrLine[] = [];
  for (const token of sorted) {
    const mid = (token.y0 + token.y1) / 2;
    const height = Math.max(8, token.y1 - token.y0);
    const line = lines.find((l) => Math.abs(l.y - mid) <= height * 0.55);
    const word = { text: token.text.trim(), confidence: token.confidence };
    if (line) {
      line.words.push(word);
      line.text = line.words.map((w) => w.text).join(' ');
      line.y = (line.y + mid) / 2;
    } else {
      lines.push({ y: mid, text: word.text, words: [word] });
    }
  }
  return lines.sort((a, b) => a.y - b.y);
}

function linesFromText(text: string): OcrLine[] {
  return text.split(/\n/).map((raw) => raw.trim()).filter(Boolean).map((line, i) => ({
    y: i,
    text: line,
    words: line.split(/\s+/).filter(Boolean).map((w) => ({ text: w, confidence: 90 })),
  }));
}

function isDobLine(text: string): boolean {
  return /\b(dob|d\.o\.b|date of birth|year of birth|जन्म)\b/i.test(text);
}

function nameFromLine(line: OcrLine, beforeDobOnly: boolean): ExtractedField | null {
  const source = beforeDobOnly ? (line.text.split(/\b(?:dob|d\.o\.b|date of birth|year of birth|जन्म)\b/i)[0] ?? '') : line.text;
  const allowed = new Set(nameWords(source));
  const words = line.words
    .map((w) => ({ text: w.text.replace(/[^A-Za-z]/g, ''), confidence: w.confidence }))
    .filter((w) => allowed.has(w.text));
  if (words.length < 2) return null;
  const value = words.map((w) => w.text).join(' ');
  const confidence = Math.min(...words.map((w) => w.confidence)) / 100;
  const repeated = /(.)\1\1/i.test(value);
  const uncertain = repeated || words.some((w) => w.confidence < 75) || (beforeDobOnly && words.length > 2);
  return field(value, uncertain ? Math.min(confidence, 0.45) : confidence, 'OCR', uncertain ? 'NEEDS_REVIEW' : 'READ');
}

/**
 * The name is the printed English line above the date. A stray mark or a few
 * noise characters can sit on a line of their own between the two, so up to
 * three lines above the date are checked, nearest first, and the first one
 * that reads as a name is used. Words from lines further up are not included.
 * Digits are never edited to force a checksum.
 */
function nameField(lines: OcrLine[]): ExtractedField | null {
  const dobAt = lines.findIndex((l) => isDobLine(l.text));
  if (dobAt > 0) {
    for (let i = dobAt - 1; i >= Math.max(0, dobAt - 3); i--) {
      const found = nameFromLine(lines[i]!, false);
      if (found) return found;
    }
    return null;
  }
  if (dobAt === 0) return nameFromLine(lines[0]!, true);
  return null;
}

/** A run of digit tokens that is exactly 12 digits. A 16-digit VID is left out. */
function aadhaarDigits(text: string): string | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  let found: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d+$/.test(tokens[i]!)) continue;
    const seq: string[] = [];
    while (i < tokens.length && /^\d+$/.test(tokens[i]!)) seq.push(tokens[i++]!);
    i -= 1;
    const digits = seq.join('');
    if (digits.length === 12 && /^[2-9]/.test(digits)) found = digits;
  }
  return found;
}

function numberField(lines: OcrLine[]): ExtractedField | null {
  const hits: Array<{ value: string; confidence: number; y: number }> = [];
  for (const line of lines) {
    const digits = aadhaarDigits(line.text);
    if (!digits) continue;
    const digitWords = line.words.filter((w) => /\d/.test(w.text));
    const confidence = digitWords.length ? Math.min(...digitWords.map((w) => w.confidence)) / 100 : 0.6;
    hits.push({ value: digits, confidence, y: line.y });
  }
  const hit = hits.sort((a, b) => a.y - b.y).at(-1);
  if (!hit) return null;
  const valid = isValidAadhaarNumber(hit.value);
  return field(hit.value, valid ? hit.confidence : Math.min(hit.confidence, 0.5), 'PATTERN', valid ? 'VALIDATED' : 'NEEDS_REVIEW');
}

/** Lines after an Address label. A noisy read is kept for review and is not rewritten. */
function addressField(lines: OcrLine[]): ExtractedField | null {
  const start = lines.findIndex((l) => /\baddress\b/i.test(l.text));
  if (start < 0) return null;
  const parts: string[] = [];
  const words: Array<{ confidence: number }> = [];
  for (const line of lines.slice(start, start + 6)) {
    const piece = line.text.replace(/\baddress\b\s*[:/]?/i, '').trim();
    if (piece) {
      parts.push(piece);
      words.push(...line.words);
    }
    if (/\b\d{6}\b/.test(line.text)) break;
  }
  const raw = parts.join(', ').replace(/\s+/g, ' ').trim();
  if (raw.length < 8) return null;
  // Letters, digits and ordinary address punctuation (D/O:, PO:, H NO 4-30, (near)) are not noise.
  const noise = (raw.match(/[^A-Za-z0-9,./\-\s:#&'()]/g) ?? []).length / raw.length;
  // Many low-confidence words means other text (a QR code, a stamp) leaked into the lines: keep it for review.
  const weak = words.length ? words.filter((w) => w.confidence < 50).length / words.length : 0;
  const unsure = noise > 0.04 || weak > 0.25;
  return field(raw, unsure ? 0.3 : 0.7, 'OCR', unsure ? 'NEEDS_REVIEW' : 'READ');
}

export const aadhaarAdapter: DocumentAdapter = {
  type: 'AADHAAR',
  label: 'Aadhaar',
  expectedFields: ['fullName', 'dateOfBirth', 'gender', 'documentNumber', 'address'],
  requiredFields: ['fullName', 'documentNumber'],
  expectedElements: ['PHOTOGRAPH'],
  hasExpiry: false,
  structureKnown: true,

  detect(text) {
    const d = scoreFeatures(text, [
      { label: 'Aadhaar wording', pattern: /\b(aadhaar|aadhar)\b|आधार/i, weight: 0.35 },
      { label: 'UIDAI issuer line', pattern: /\b(uidai|unique identification authority)\b/i, weight: 0.35 },
      { label: 'Government of India', pattern: /\bgovernment of india\b|भारत सरकार/i, weight: 0.15 },
      { label: 'DOB / year of birth', pattern: /\b(dob|d\.o\.b|year of birth)\b|जन्म तिथि/i, weight: 0.15 },
      { label: '12-digit number in groups of four', pattern: /\b(?:\d{4}|[Xx]{4})\s\d{4}\s\d{4}\b|\b(?:[Xx*]{4}\s?){2}\d{4}\b/, weight: 0.25 },
      { label: 'VID', pattern: VID, weight: 0.15 },
    ]);
    const n = text.match(FULL_NUMBER);
    if (n && isValidAadhaarNumber(`${n[1]}${n[2]}${n[3]}`)) {
      d.score = Math.min(1, d.score + 0.3);
      d.evidence.push('Verhoeff-valid 12-digit number');
    }
    return d;
  },

  extract(text, ctx) {
    const lines = ctx.tokens?.length ? linesFromTokens(ctx.tokens) : linesFromText(text);
    const t = cleanText(lines.map((l) => l.text).join('\n'));
    const fields: ExtractedFields = {};
    const number = numberField(lines);
    const masked = t.match(MASKED_NUMBER);
    if (number) fields.documentNumber = number;
    else if (masked) fields.documentNumber = field(`XXXXXXXX${masked[1]}`, 0.8, 'PATTERN', 'READ');
    const vid = t.match(VID);
    if (vid) fields.virtualId = field(vid[1]!.replace(/\s/g, ''), 0.8, 'PATTERN');

    const dob = parseDate(dateAfter(t, /\b(dob|d\.o\.b\.?|date of birth)\b|जन्म तिथि/i));
    if (dob) fields.dateOfBirth = field(dob, 0.9, 'OCR', 'VALIDATED');
    else {
      const yob = t.match(/\byear of birth\s*[:/]?\s*((?:19|20)\d{2})\b/i);
      if (yob) fields.yearOfBirth = field(yob[1]!, 0.8, 'OCR', 'READ');
    }
    const g = genderIn(t);
    if (g) fields.gender = field(g, 0.85, 'OCR', 'READ');
    const name = nameField(lines);
    if (name) fields.fullName = name;
    const address = addressField(lines);
    if (address) fields.address = address;
    fields.issuingAuthority = field('UIDAI', 0.9, 'PATTERN', 'READ');
    return fields;
  },

  validate(fields, ctx) {
    const out: Finding[] = [];
    const i = ctx.documentIndex;
    const n = fields.documentNumber?.value;
    if (n?.startsWith('XXXXXXXX')) {
      out.push({ code: 'NUMBER_STRUCTURE_VALID', severity: 'INFO', message: 'Aadhaar: this is a masked Aadhaar, so the checksum cannot be checked.', documentIndex: i, field: 'documentNumber', evidence: ['masked number'] });
    } else if (n) {
      out.push(isValidAadhaarNumber(n)
        ? { code: 'CHECKSUM_VALID', severity: 'INFO', message: 'Aadhaar: the number passes the Verhoeff checksum.', documentIndex: i, field: 'documentNumber', evidence: ['Verhoeff checksum'] }
        : { code: 'CHECKSUM_INVALID', severity: 'HIGH', message: 'Aadhaar: the number fails the Verhoeff checksum. It may be misread or not a real Aadhaar number.', documentIndex: i, field: 'documentNumber', evidence: ['Verhoeff checksum'] });
    }
    if (!fields.dateOfBirth && !fields.yearOfBirth) {
      out.push({ code: 'MISSING_FIELD', severity: 'LOW', message: 'Aadhaar: could not read the date or year of birth.', documentIndex: i, field: 'dateOfBirth' });
    }
    out.push(...dateFindings('Aadhaar', fields, ctx, { hasExpiry: false }));
    out.push(...missingRequired(this, fields, i));
    return out;
  },
};
