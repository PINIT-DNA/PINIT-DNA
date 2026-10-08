/**
 * PAN card (Income Tax Department). No photo-free variant exists for individuals,
 * no expiry, no address. Structure: AAAAA9999A; 4th letter = holder type,
 * 5th letter = first letter of the surname (individuals) — checked in Cross-ID.
 */
import type { ExtractedFields, Finding } from '../types';
import { PAN_HOLDER_TYPES, PAN_PATTERN } from '../checksums';
import { cleanText, parseDate } from '../normalize';
import { dateAfter, field, missingRequired, scoreFeatures, wordsAfter, type DocumentAdapter } from './adapter';
import { dateFindings } from './rules';

const PAN_IN_TEXT = /\b([A-Z]{5}\d{4}[A-Z])\b/;

export const panAdapter: DocumentAdapter = {
  type: 'PAN',
  label: 'PAN card',
  expectedFields: ['fullName', 'fatherOrGuardianName', 'dateOfBirth', 'documentNumber'],
  // Since 2018 a PAN may print the mother's name instead of the father's.
  requiredFields: ['fullName', 'documentNumber'],
  expectedElements: ['PHOTOGRAPH', 'SIGNATURE'],
  hasExpiry: false,
  structureKnown: true,

  detect(text) {
    const d = scoreFeatures(text, [
      { label: 'Income Tax Department', pattern: /\bincome\s*tax\s*department\b/i, weight: 0.45 },
      { label: 'Permanent Account Number', pattern: /\bpermanent\s*account\s*number\b/i, weight: 0.45 },
      { label: 'PAN-shaped number', pattern: /\b[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]\b/, weight: 0.35 },
      { label: "Father's Name label", pattern: /\bfather'?s\s*name\b/i, weight: 0.1 },
    ]);
    return d;
  },

  extract(text) {
    const t = cleanText(text);
    const fields: ExtractedFields = {};
    const n = t.toUpperCase().match(PAN_IN_TEXT);
    if (n) fields.documentNumber = field(n[1]!, PAN_PATTERN.test(n[1]!) ? 0.9 : 0.6, 'PATTERN');
    const name = wordsAfter(t, /\bname\s*[:/]/i, 4)
      || wordsAfter(t, /(?:govt\.?|government)\s+of\s+india/i, 4);
    if (name) fields.fullName = field(name, 0.6, 'OCR');
    const father = wordsAfter(t, /\bfather'?s\s*name\s*[:/]?/i, 4);
    if (father) fields.fatherOrGuardianName = field(father, 0.55, 'OCR');
    const mother = wordsAfter(t, /\bmother'?s\s*name\s*[:/]?/i, 4);
    if (mother) fields.motherName = field(mother, 0.55, 'OCR');
    const dob = parseDate(dateAfter(t, /\b(date of birth|dob)\b/i)) || parseDate((t.match(/\b(\d{2}\/\d{2}\/\d{4})\b/) || [])[1]);
    if (dob) fields.dateOfBirth = field(dob, 0.7, 'OCR');
    fields.issuingAuthority = field('Income Tax Department, Govt. of India', 0.9, 'PATTERN');
    return fields;
  },

  validate(fields, ctx) {
    const out: Finding[] = [];
    const i = ctx.documentIndex;
    const n = fields.documentNumber?.value;
    if (n) {
      if (PAN_PATTERN.test(n)) {
        const holder = PAN_HOLDER_TYPES[n[3]!] ?? 'Unknown';
        out.push({ code: 'NUMBER_STRUCTURE_VALID', severity: 'INFO', message: `PAN: the number has a valid structure (holder type: ${holder}).`, documentIndex: i, field: 'documentNumber', evidence: ['PAN structure AAAAA9999A', `4th character = ${holder}`] });
        if (n[3] !== 'P') {
          out.push({ code: 'NUMBER_STRUCTURE_INVALID', severity: 'HIGH', message: `PAN: this PAN belongs to a ${holder.toLowerCase()}, not an individual person.`, documentIndex: i, field: 'documentNumber' });
        }
      } else {
        out.push({ code: 'NUMBER_STRUCTURE_INVALID', severity: 'HIGH', message: 'PAN: the number does not have a valid PAN structure.', documentIndex: i, field: 'documentNumber' });
      }
    }
    out.push(...dateFindings('PAN card', fields, ctx, { hasExpiry: false }));
    out.push(...missingRequired(this, fields, i));
    return out;
  },
};
