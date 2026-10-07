/**
 * Fallback for officially issued IDs without a dedicated adapter (state IDs,
 * employee IDs from government bodies, foreign national IDs). Only generic
 * fields are read and no type-specific check exists, so a document classified
 * here can never pass on its own — the decision always asks for review.
 */
import type { ExtractedFields, Finding } from '../types';
import { cleanText, parseDate } from '../normalize';
import { dateAfter, field, genderIn, missingRequired, scoreFeatures, wordsAfter, type DocumentAdapter } from './adapter';
import { dateFindings } from './rules';

export const governmentIdAdapter: DocumentAdapter = {
  type: 'GOVERNMENT_ID',
  label: 'Government ID',
  expectedFields: ['fullName', 'dateOfBirth', 'documentNumber', 'issuingAuthority', 'expiryDate'],
  requiredFields: ['fullName', 'documentNumber'],
  expectedElements: ['PHOTOGRAPH'],
  hasExpiry: true,
  structureKnown: false,

  detect(text) {
    const d = scoreFeatures(text, [
      { label: 'government issuer', pattern: /\b(government of|republic of|ministry of|state of)\b/i, weight: 0.25 },
      { label: 'identity card wording', pattern: /\b(identity card|national id(?:entity)?|resident (?:card|identity)|id card)\b/i, weight: 0.3 },
      { label: 'ID number label', pattern: /\b(id(?:entity)? (?:no|number)|card no)\b/i, weight: 0.15 },
      { label: 'date of birth label', pattern: /\b(date of birth|dob)\b/i, weight: 0.1 },
    ]);
    // Never outrank a dedicated adapter on the same evidence.
    d.score = Math.min(d.score, 0.5);
    return d;
  },

  extract(text) {
    const t = cleanText(text);
    const fields: ExtractedFields = {};
    const name = wordsAfter(t, /\bname\s*[:/]/i, 4);
    if (name) fields.fullName = field(name, 0.5, 'OCR');
    const num = t.match(/\b(?:id(?:entity)?\s*(?:no|number)|card\s*no|no)\.?\s*[:/]?\s*([A-Z0-9-]{6,20})\b/i);
    if (num) fields.documentNumber = field(num[1]!.toUpperCase(), 0.5, 'OCR');
    const dob = parseDate(dateAfter(t, /\b(date of birth|dob)\b/i));
    if (dob) fields.dateOfBirth = field(dob, 0.6, 'OCR');
    const exp = parseDate(dateAfter(t, /\b(date of expiry|expiry|valid (?:till|until|upto))\b/i));
    if (exp) fields.expiryDate = field(exp, 0.6, 'OCR');
    const issuer = t.match(/\b((?:government|republic|ministry|state) of [A-Za-z ]{3,40}?)(?=\s{1,}|$)/i);
    if (issuer) fields.issuingAuthority = field(issuer[1]!.trim(), 0.5, 'OCR');
    const g = genderIn(t);
    if (g) fields.gender = field(g, 0.5, 'OCR');
    return fields;
  },

  validate(fields, ctx) {
    const out: Finding[] = [
      {
        code: 'TYPE_RECOGNISED', severity: 'LOW',
        message: 'Government ID: no document-specific checks exist for this type yet, so a person must review it.',
        documentIndex: ctx.documentIndex,
      },
    ];
    out.push(...dateFindings('Government ID', fields, ctx, { hasExpiry: true }));
    out.push(...missingRequired(this, fields, ctx.documentIndex));
    return out;
  },
};
