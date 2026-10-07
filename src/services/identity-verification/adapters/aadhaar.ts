/**
 * Aadhaar (UIDAI). Front: name, DOB or year of birth, gender, 12-digit number.
 * Back: address. The number's last digit is a Verhoeff checksum. A masked
 * Aadhaar (XXXX XXXX 1234) cannot be checksummed and is reported as such.
 */
import type { ExtractedFields, Finding } from '../types';
import { isValidAadhaarNumber } from '../checksums';
import { cleanText, parseDate } from '../normalize';
import { dateAfter, field, genderIn, missingRequired, scoreFeatures, wordsAfter, type DocumentAdapter } from './adapter';
import { dateFindings } from './rules';

const FULL_NUMBER = /\b([2-9]\d{3})\s?(\d{4})\s?(\d{4})\b/;
const MASKED_NUMBER = /\b[Xx*]{4}\s?[Xx*]{4}\s?(\d{4})\b/;
const VID = /\bVID\s*[:]?\s*(\d{4}\s?\d{4}\s?\d{4}\s?\d{4})\b/i;

/** Name on the front sits between the issuer line and the DOB line. */
function nameOnFront(t: string): string | null {
  const labelled = wordsAfter(t, /\bname\s*[:/]/i, 4);
  if (labelled) return labelled;
  const m = t.match(/(?:government of india|भारत सरकार)\s+(.{3,80}?)\s+(?:dob|d\.o\.b|year of birth|जन्म)/i);
  if (!m) return null;
  const words = m[1]!.split(/\s+/).filter((w) => /^[A-Za-z.]{1,30}$/.test(w));
  return words.length ? words.slice(-4).join(' ') : null;
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

  extract(text) {
    const t = cleanText(text);
    const fields: ExtractedFields = {};
    const full = t.match(FULL_NUMBER);
    const masked = t.match(MASKED_NUMBER);
    if (full) {
      const n = `${full[1]}${full[2]}${full[3]}`;
      fields.documentNumber = field(n, isValidAadhaarNumber(n) ? 0.95 : 0.6, 'PATTERN');
    } else if (masked) {
      fields.documentNumber = field(`XXXXXXXX${masked[1]}`, 0.8, 'PATTERN');
    }
    const vid = t.match(VID);
    if (vid) fields.virtualId = field(vid[1]!.replace(/\s/g, ''), 0.8, 'PATTERN');

    const dob = parseDate(dateAfter(t, /\b(dob|d\.o\.b\.?|date of birth)\b|जन्म तिथि/i));
    if (dob) fields.dateOfBirth = field(dob, 0.8, 'OCR');
    else {
      const yob = t.match(/\byear of birth\s*[:/]?\s*((?:19|20)\d{2})\b/i);
      if (yob) fields.yearOfBirth = field(yob[1]!, 0.75, 'OCR');
    }
    const g = genderIn(t);
    if (g) fields.gender = field(g, 0.8, 'OCR');
    const name = nameOnFront(t);
    if (name) fields.fullName = field(name, 0.6, 'OCR');

    const addr = t.match(/\baddress\s*[:/]?\s*(.{10,240}?\b\d{6}\b)/i);
    if (addr) fields.address = field(addr[1]!.replace(/\s+/g, ' ').trim(), 0.55, 'OCR');
    fields.issuingAuthority = field('UIDAI', 0.9, 'PATTERN');
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
