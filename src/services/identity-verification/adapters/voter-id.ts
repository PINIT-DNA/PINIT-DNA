/**
 * Voter ID / EPIC (Election Commission of India). Structure: 3 letters + 7 digits.
 * Issued only to adults (18+). No expiry.
 */
import type { ExtractedFields, Finding } from '../types';
import { EPIC_PATTERN } from '../checksums';
import { ageOn, cleanText, parseDate } from '../normalize';
import { dateAfter, field, genderIn, missingRequired, scoreFeatures, wordsAfter, type DocumentAdapter } from './adapter';
import { dateFindings } from './rules';

const EPIC_IN_TEXT = /\b([A-Z]{3}\d{7})\b/;

export const voterIdAdapter: DocumentAdapter = {
  type: 'VOTER_ID',
  label: 'Voter ID',
  expectedFields: ['fullName', 'fatherOrGuardianName', 'gender', 'dateOfBirth', 'documentNumber', 'address', 'electoralConstituency'],
  requiredFields: ['fullName', 'documentNumber'],
  expectedElements: ['PHOTOGRAPH'],
  hasExpiry: false,
  structureKnown: true,

  detect(text) {
    return scoreFeatures(text, [
      { label: 'Election Commission of India', pattern: /\belection commission\b/i, weight: 0.45 },
      { label: 'elector wording', pattern: /\b(elector'?s? (?:photo )?identity card|electors? name|epic)\b/i, weight: 0.35 },
      { label: 'EPIC-shaped number', pattern: EPIC_IN_TEXT, weight: 0.3 },
    ]);
  },

  extract(text) {
    const t = cleanText(text);
    const fields: ExtractedFields = {};
    const n = t.toUpperCase().match(EPIC_IN_TEXT);
    if (n) fields.documentNumber = field(n[1]!, 0.85, 'PATTERN');
    const name = wordsAfter(t, /\b(elector'?s? name|name)\s*[:/]/i, 4);
    if (name) fields.fullName = field(name, 0.6, 'OCR');
    const rel = wordsAfter(t, /\b(father'?s|husband'?s|mother'?s|relation'?s?)\s*name\s*[:/]?/i, 4);
    if (rel) fields.fatherOrGuardianName = field(rel, 0.5, 'OCR');
    const dob = parseDate(dateAfter(t, /\b(date of birth|dob)\b/i));
    if (dob) fields.dateOfBirth = field(dob, 0.7, 'OCR');
    else {
      const yob = t.match(/\byear of birth\s*[:/]?\s*((?:19|20)\d{2})\b/i);
      if (yob) fields.yearOfBirth = field(yob[1]!, 0.65, 'OCR');
    }
    const ac = t.match(/\bassembly constituency(?: no\.?)?(?: (?:&|and) name)?\s*[:/]?\s*(\d{1,3}\s*[-–]?\s*[A-Za-z][A-Za-z .]{2,40}?)(?=\s+(?:part|address)\b|$)/i);
    if (ac) fields.electoralConstituency = field(ac[1]!.replace(/\s+/g, ' ').trim(), 0.55, 'OCR');
    const part = t.match(/\bpart no\.?(?: (?:&|and) name)?\s*[:/]?\s*(\d{1,4})\b/i);
    if (part) fields.electoralPartNumber = field(part[1]!, 0.6, 'OCR');
    const g = genderIn(t);
    if (g) fields.gender = field(g, 0.7, 'OCR');
    const addr = t.match(/\baddress\s*[:/]?\s*(.{10,240}?\b\d{6}\b)/i);
    if (addr) fields.address = field(addr[1]!.trim(), 0.5, 'OCR');
    fields.issuingAuthority = field('Election Commission of India', 0.9, 'PATTERN');
    return fields;
  },

  validate(fields, ctx) {
    const out: Finding[] = [];
    const i = ctx.documentIndex;
    const n = fields.documentNumber?.value;
    if (n) {
      out.push(EPIC_PATTERN.test(n)
        ? { code: 'NUMBER_STRUCTURE_VALID', severity: 'INFO', message: 'Voter ID: the EPIC number has a valid structure.', documentIndex: i, field: 'documentNumber' }
        : { code: 'NUMBER_STRUCTURE_INVALID', severity: 'MEDIUM', message: 'Voter ID: the EPIC number does not have a valid structure.', documentIndex: i, field: 'documentNumber' });
    }
    const dob = fields.dateOfBirth?.value;
    if (dob) {
      const age = ageOn(dob, ctx.now);
      if (age !== null && age < 18) {
        out.push({ code: 'UNDERAGE_FOR_DOCUMENT', severity: 'HIGH', message: 'Voter ID: the holder is under 18, but voter IDs are issued only to adults.', documentIndex: i, field: 'dateOfBirth' });
      }
    }
    out.push(...dateFindings('Voter ID', fields, ctx, { hasExpiry: false }));
    out.push(...missingRequired(this, fields, i));
    return out;
  },
};
