/**
 * Indian driving licence (Sarathi format): SS RR YYYY NNNNNNN — state code,
 * RTO code, year of issue, serial. Carries validity dates and vehicle classes.
 */
import type { ExtractedFields, Finding } from '../types';
import { INDIAN_STATE_CODES, parseIndianDlNumber } from '../checksums';
import { cleanText, parseDate } from '../normalize';
import { dateAfter, field, genderIn, missingRequired, scoreFeatures, wordsAfter, type DocumentAdapter } from './adapter';
import { dateFindings } from './rules';

const DL_IN_TEXT = /\b([A-Z]{2}[-\s]?\d{2}[-\s]?\d{4}[-\s]?\d{7})\b/;
const VEHICLE_CLASSES = /\b(MCWG|MCWOG|LMV-NT|LMV-TR|LMV|HMV|HGMV|HPMV|TRANS|MGV|INVCRG|FVG|E-RICKSHAW)\b/g;

export const drivingLicenceAdapter: DocumentAdapter = {
  type: 'DRIVING_LICENCE',
  label: 'Driving licence',
  expectedFields: ['fullName', 'fatherOrGuardianName', 'dateOfBirth', 'documentNumber', 'address', 'issueDate', 'expiryDate', 'vehicleClasses', 'issuingAuthority'],
  requiredFields: ['fullName', 'dateOfBirth', 'documentNumber'],
  expectedElements: ['PHOTOGRAPH', 'SIGNATURE'],
  hasExpiry: true,
  structureKnown: true,

  detect(text) {
    return scoreFeatures(text, [
      { label: 'driving licence wording', pattern: /\b(driving licen[cs]e|driver'?s licen[cs]e|driving permit)\b/i, weight: 0.45 },
      { label: 'transport department', pattern: /\b(transport department|motor vehicles?|union of india)\b/i, weight: 0.2 },
      { label: 'DL-shaped number', pattern: DL_IN_TEXT, weight: 0.3 },
      { label: 'validity labels', pattern: /\b(valid till|validity|valid upto|date of first issue)\b/i, weight: 0.2 },
      { label: 'vehicle class codes', pattern: /\b(MCWG|LMV|HMV|COV|class of vehicle)\b/i, weight: 0.2 },
    ]);
  },

  extract(text) {
    const t = cleanText(text);
    const fields: ExtractedFields = {};
    const n = t.toUpperCase().match(DL_IN_TEXT);
    if (n) fields.documentNumber = field(n[1]!.replace(/[\s-]/g, ''), parseIndianDlNumber(n[1]!) ? 0.85 : 0.55, 'PATTERN');
    const name = wordsAfter(t, /\bname\s*[:/]/i, 4);
    if (name) fields.fullName = field(name, 0.6, 'OCR');
    const father = wordsAfter(t, /\b(s\/o|d\/o|w\/o|son of|daughter of|wife of|father'?s name)\s*[:/]?/i, 4);
    if (father) fields.fatherOrGuardianName = field(father, 0.5, 'OCR');
    const dob = parseDate(dateAfter(t, /\b(date of birth|dob|d\.o\.b\.?)\b/i));
    if (dob) fields.dateOfBirth = field(dob, 0.75, 'OCR');
    const issue = parseDate(dateAfter(t, /\b(date of (?:first )?issue|issue date|doi)\b/i));
    if (issue) fields.issueDate = field(issue, 0.7, 'OCR');
    const expiry = parseDate(dateAfter(t, /\b(valid till|valid upto|validity(?:\s*\((?:nt|tr)\))?|date of expiry)\b/i));
    if (expiry) fields.expiryDate = field(expiry, 0.7, 'OCR');
    const classes = Array.from(new Set((t.toUpperCase().match(VEHICLE_CLASSES) || [])));
    if (classes.length) fields.vehicleClasses = field(classes.join(', '), 0.7, 'OCR');
    const g = genderIn(t);
    if (g) fields.gender = field(g, 0.6, 'OCR');
    const addr = t.match(/\baddress\s*[:/]?\s*(.{10,240}?\b\d{6}\b)/i);
    if (addr) fields.address = field(addr[1]!.trim(), 0.5, 'OCR');
    const parsed = fields.documentNumber ? parseIndianDlNumber(fields.documentNumber.value) : null;
    if (parsed) fields.issuingAuthority = field(`RTO ${parsed.state}-${parsed.rto}`, 0.7, 'PATTERN');
    return fields;
  },

  validate(fields, ctx) {
    const out: Finding[] = [];
    const i = ctx.documentIndex;
    const n = fields.documentNumber?.value;
    if (n) {
      const p = parseIndianDlNumber(n);
      const thisYear = ctx.now.getUTCFullYear();
      if (!p) {
        out.push({ code: 'NUMBER_STRUCTURE_INVALID', severity: 'MEDIUM', message: 'Driving licence: the number is not in the national SS RR YYYY NNNNNNN format.', documentIndex: i, field: 'documentNumber' });
      } else if (!INDIAN_STATE_CODES.has(p.state)) {
        out.push({ code: 'NUMBER_STRUCTURE_INVALID', severity: 'HIGH', message: `Driving licence: "${p.state}" is not an Indian state code.`, documentIndex: i, field: 'documentNumber' });
      } else if (p.year < 1950 || p.year > thisYear) {
        out.push({ code: 'NUMBER_STRUCTURE_INVALID', severity: 'HIGH', message: 'Driving licence: the year inside the number is not possible.', documentIndex: i, field: 'documentNumber' });
      } else {
        out.push({ code: 'NUMBER_STRUCTURE_VALID', severity: 'INFO', message: `Driving licence: the number has a valid structure (state ${p.state}, year ${p.year}).`, documentIndex: i, field: 'documentNumber', evidence: ['state code', 'RTO code', 'year', 'serial'] });
        const issueYear = fields.issueDate ? +fields.issueDate.value.slice(0, 4) : null;
        if (issueYear && p.year > issueYear) {
          out.push({ code: 'DATE_ORDER_INVALID', severity: 'MEDIUM', message: 'Driving licence: the year in the number is after the printed issue date.', documentIndex: i, field: 'issueDate' });
        }
      }
    }
    out.push(...dateFindings('Driving licence', fields, ctx, { hasExpiry: true, minimumAgeAtIssue: 16 }));
    out.push(...missingRequired(this, fields, i));
    return out;
  },
};
