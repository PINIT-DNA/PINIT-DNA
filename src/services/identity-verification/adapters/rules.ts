/** Date logic shared by every adapter. */
import type { ExtractedFields, Finding } from '../types';
import { ageOn, parseDate } from '../normalize';

/** Date-shaped text that is not a real calendar date (e.g. 31/02/2000 or 12/13/1990). */
export function impossibleDateFindings(label: string, text: string, documentIndex: number): Finding[] {
  let bad = 0;
  for (const m of text.matchAll(/\b\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)\d{2}\b/g)) {
    if (!parseDate(m[0])) bad++;
  }
  return bad
    ? [{
      code: 'DATE_INVALID', severity: 'MEDIUM', documentIndex,
      message: `${label}: ${bad} printed date(s) are not real calendar dates (for example 31/02). This can be a misread or an edit.`,
    }]
    : [];
}
import type { AdapterContext } from './adapter';

export function dateFindings(
  label: string,
  fields: ExtractedFields,
  ctx: AdapterContext,
  opts: { hasExpiry: boolean; minimumAgeAtIssue?: number },
): Finding[] {
  const out: Finding[] = [];
  const i = ctx.documentIndex;
  const today = ctx.now.toISOString().slice(0, 10);
  const dob = fields.dateOfBirth?.value;
  const issue = fields.issueDate?.value;
  const expiry = fields.expiryDate?.value;

  if (dob && dob > today) {
    out.push({ code: 'DATE_INVALID', severity: 'HIGH', message: `${label}: the date of birth is in the future.`, documentIndex: i, field: 'dateOfBirth' });
  }
  if (issue && issue > today) {
    out.push({ code: 'DATE_INVALID', severity: 'HIGH', message: `${label}: the issue date is in the future.`, documentIndex: i, field: 'issueDate' });
  }
  if (dob && issue && issue < dob) {
    out.push({ code: 'DATE_ORDER_INVALID', severity: 'HIGH', message: `${label}: issued before the holder was born.`, documentIndex: i, field: 'issueDate' });
  }
  if (issue && expiry && expiry <= issue) {
    out.push({ code: 'DATE_ORDER_INVALID', severity: 'HIGH', message: `${label}: expires on or before its issue date.`, documentIndex: i, field: 'expiryDate' });
  }
  if (dob && issue && opts.minimumAgeAtIssue !== undefined) {
    const age = ageOn(dob, new Date(`${issue}T00:00:00Z`));
    if (age !== null && age < opts.minimumAgeAtIssue) {
      out.push({
        code: 'UNDERAGE_FOR_DOCUMENT', severity: 'HIGH',
        message: `${label}: the holder would have been ${age} when it was issued; the minimum is ${opts.minimumAgeAtIssue}.`,
        documentIndex: i, field: 'issueDate',
      });
    }
  }
  if (opts.hasExpiry && expiry) {
    if (expiry < today) {
      out.push({ code: 'DOCUMENT_EXPIRED', severity: 'HIGH', message: `${label}: expired on ${expiry}.`, documentIndex: i, field: 'expiryDate' });
    } else {
      out.push({ code: 'DOCUMENT_NOT_EXPIRED', severity: 'INFO', message: `${label}: valid until ${expiry}.`, documentIndex: i, field: 'expiryDate' });
    }
  }
  return out;
}
