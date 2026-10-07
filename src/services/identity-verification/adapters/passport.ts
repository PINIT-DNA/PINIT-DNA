/**
 * Passport (ICAO 9303 TD3). The MRZ is the strongest evidence on a passport:
 * its check digits tie the number, birth date and expiry together.
 */
import type { ExtractedFields, Finding } from '../types';
import { icaoValid } from '../checksums';
import { cleanText, parseDate, parseMrzDate } from '../normalize';
import { dateAfter, field, genderIn, missingRequired, scoreFeatures, wordsAfter, type DocumentAdapter } from './adapter';
import { dateFindings } from './rules';

export interface Td3Mrz {
  documentCode: string;
  issuingCountry: string;
  surname: string;
  givenNames: string;
  number: string;
  numberCheck: string;
  nationality: string;
  birth: string;
  birthCheck: string;
  sex: string;
  expiry: string;
  expiryCheck: string;
  personal: string;
  personalCheck: string;
  compositeCheck: string;
}

const LINE2 = /([A-Z0-9<]{9})([0-9<])([A-Z<]{3})(\d{6})(\d)([MFX<])(\d{6})(\d)([A-Z0-9<]{14})([0-9<])(\d)/;

/** OCR merges lines, so the MRZ is found on the text with spaces removed. */
export function findTd3(text: string): Td3Mrz | null {
  const flat = text.toUpperCase().replace(/[«‹]/g, '<').replace(/\s+/g, '');
  const l2 = flat.match(LINE2);
  if (!l2 || l2.index === undefined) return null;
  const before = flat.slice(0, l2.index);
  const l1Start = before.lastIndexOf('P<') >= 0 ? before.lastIndexOf('P<') : before.search(/P[A-Z][A-Z<]{3}[A-Z]/);
  let issuingCountry = l2[3]!.replace(/</g, '');
  let surname = '';
  let givenNames = '';
  if (l1Start >= 0) {
    const line1 = before.slice(l1Start, l1Start + 44);
    issuingCountry = line1.slice(2, 5).replace(/</g, '') || issuingCountry;
    const names = line1.slice(5);
    const [sur, given = ''] = names.split('<<');
    surname = (sur || '').replace(/</g, ' ').trim();
    givenNames = given.replace(/</g, ' ').replace(/\s+/g, ' ').trim();
  }
  return {
    documentCode: 'P',
    issuingCountry,
    surname,
    givenNames,
    number: l2[1]!,
    numberCheck: l2[2]!,
    nationality: l2[3]!.replace(/</g, ''),
    birth: l2[4]!,
    birthCheck: l2[5]!,
    sex: l2[6]!,
    expiry: l2[7]!,
    expiryCheck: l2[8]!,
    personal: l2[9]!,
    personalCheck: l2[10]!,
    compositeCheck: l2[11]!,
  };
}

export function td3CheckResults(m: Td3Mrz): Record<'number' | 'birth' | 'expiry' | 'personal' | 'composite', boolean> {
  const composite = `${m.number}${m.numberCheck}${m.birth}${m.birthCheck}${m.expiry}${m.expiryCheck}${m.personal}${m.personalCheck}`;
  return {
    number: icaoValid(m.number, m.numberCheck),
    birth: icaoValid(m.birth, m.birthCheck),
    expiry: icaoValid(m.expiry, m.expiryCheck),
    personal: icaoValid(m.personal, m.personalCheck),
    composite: icaoValid(composite, m.compositeCheck),
  };
}

export const passportAdapter: DocumentAdapter = {
  type: 'PASSPORT',
  label: 'Passport',
  expectedFields: ['fullName', 'dateOfBirth', 'gender', 'documentNumber', 'nationality', 'issueDate', 'expiryDate', 'issuingCountry', 'placeOfBirth'],
  requiredFields: ['fullName', 'dateOfBirth', 'documentNumber', 'expiryDate'],
  expectedElements: ['PHOTOGRAPH', 'SIGNATURE', 'MRZ'],
  hasExpiry: true,
  structureKnown: true,

  detect(text) {
    const d = scoreFeatures(text, [
      { label: 'word "passport"', pattern: /\bpassport\b/i, weight: 0.35 },
      { label: 'machine-readable zone', pattern: /P<[A-Z<]{3}/, weight: 0.45 },
      { label: 'surname / given names labels', pattern: /\b(surname|given names?)\b/i, weight: 0.2 },
      { label: 'place of issue / expiry labels', pattern: /\b(place of issue|date of expiry|place of birth)\b/i, weight: 0.15 },
    ]);
    if (findTd3(text)) {
      d.score = Math.min(1, d.score + 0.4);
      if (!d.evidence.includes('machine-readable zone')) d.evidence.push('machine-readable zone');
    }
    return d;
  },

  extract(text, ctx) {
    const t = cleanText(text);
    const fields: ExtractedFields = {};
    const mrz = findTd3(t);
    if (mrz) {
      const name = [mrz.givenNames, mrz.surname].filter(Boolean).join(' ').trim();
      if (name) fields.fullName = field(name, 0.9, 'MRZ');
      fields.documentNumber = field(mrz.number.replace(/</g, ''), 0.95, 'MRZ');
      if (mrz.nationality) fields.nationality = field(mrz.nationality, 0.9, 'MRZ');
      if (mrz.issuingCountry) fields.issuingCountry = field(mrz.issuingCountry, 0.9, 'MRZ');
      const dob = parseMrzDate(mrz.birth, 'birth', ctx.now);
      if (dob) fields.dateOfBirth = field(dob, 0.95, 'MRZ');
      const exp = parseMrzDate(mrz.expiry, 'expiry', ctx.now);
      if (exp) fields.expiryDate = field(exp, 0.95, 'MRZ');
      if (mrz.sex !== '<') fields.gender = field(mrz.sex, 0.9, 'MRZ');
    }
    // Visual zone — used when the MRZ is missing or to fill fields the MRZ lacks.
    if (!fields.fullName) {
      const surname = wordsAfter(t, /\bsurname\b/i, 3);
      const given = wordsAfter(t, /\bgiven names?\b/i, 4);
      const name = [given, surname].filter(Boolean).join(' ');
      if (name) fields.fullName = field(name, 0.6, 'OCR');
    }
    if (!fields.documentNumber) {
      const n = t.match(/\bpassport\s*no\.?\s*[:/]?\s*([A-Z][0-9]{7})\b/i) || t.match(/\b([A-Z][0-9]{7})\b/);
      if (n) fields.documentNumber = field(n[1]!.toUpperCase(), 0.6, 'PATTERN');
    }
    if (!fields.dateOfBirth) {
      const d = parseDate(dateAfter(t, /\bdate of birth\b/i));
      if (d) fields.dateOfBirth = field(d, 0.65, 'OCR');
    }
    if (!fields.expiryDate) {
      const d = parseDate(dateAfter(t, /\bdate of expiry\b/i));
      if (d) fields.expiryDate = field(d, 0.65, 'OCR');
    }
    const issue = parseDate(dateAfter(t, /\bdate of issue\b/i));
    if (issue) fields.issueDate = field(issue, 0.65, 'OCR');
    const pob = wordsAfter(t, /\bplace of birth\b/i, 3);
    if (pob) fields.placeOfBirth = field(pob, 0.5, 'OCR');
    if (!fields.gender) {
      const g = genderIn(t);
      if (g) fields.gender = field(g, 0.5, 'OCR');
    }
    return fields;
  },

  validate(fields, ctx, text) {
    const out: Finding[] = [];
    const i = ctx.documentIndex;
    const mrz = findTd3(cleanText(text));
    if (mrz) {
      const checks = td3CheckResults(mrz);
      const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
      if (failed.length === 0) {
        out.push({ code: 'CHECKSUM_VALID', severity: 'INFO', message: 'Passport: every MRZ check digit is correct.', documentIndex: i, evidence: ['ICAO 9303 check digits: number, birth, expiry, personal, composite'] });
      } else {
        out.push({
          code: 'CHECKSUM_INVALID', severity: 'HIGH',
          message: `Passport: MRZ check digits do not match (${failed.join(', ')}). The MRZ may be misread or altered.`,
          documentIndex: i, evidence: failed.map((f) => `${f} check digit`),
        });
      }
      // The printed fields should agree with the MRZ.
      const printedDob = parseDate(dateAfter(cleanText(text), /\bdate of birth\b/i));
      const mrzDob = parseMrzDate(mrz.birth, 'birth', ctx.now);
      if (printedDob && mrzDob && printedDob !== mrzDob) {
        out.push({ code: 'STRUCTURE_INCONSISTENT', severity: 'HIGH', message: 'Passport: the printed date of birth differs from the MRZ.', documentIndex: i, field: 'dateOfBirth' });
      }
      const printedNo = cleanText(text).match(/\bpassport\s*no\.?\s*[:/]?\s*([A-Z][0-9]{7})\b/i)?.[1]?.toUpperCase();
      if (printedNo && printedNo !== mrz.number.replace(/</g, '')) {
        out.push({ code: 'STRUCTURE_INCONSISTENT', severity: 'HIGH', message: 'Passport: the printed passport number differs from the MRZ.', documentIndex: i, field: 'documentNumber' });
      }
    } else if (fields.documentNumber) {
      const ok = /^[A-Z][0-9]{7}$/.test(fields.documentNumber.value);
      out.push(ok
        ? { code: 'NUMBER_STRUCTURE_VALID', severity: 'INFO', message: 'Passport: the number has the expected structure (no MRZ was readable to confirm it).', documentIndex: i, field: 'documentNumber' }
        : { code: 'NUMBER_STRUCTURE_INVALID', severity: 'MEDIUM', message: 'Passport: the number does not have the expected structure.', documentIndex: i, field: 'documentNumber' });
    }
    out.push(...dateFindings('Passport', fields, ctx, { hasExpiry: true }));
    out.push(...missingRequired(this, fields, i));
    return out;
  },

  readElements(text) {
    return findTd3(cleanText(text))
      ? { MRZ: { status: 'PRESENT', evidence: 'machine-readable zone read' } }
      : { MRZ: { status: 'MISSING', evidence: 'no machine-readable zone could be read' } };
  },
};
