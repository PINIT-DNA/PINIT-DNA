/**
 * Cross-ID matching. Differences are explained and graded, not auto-rejected:
 * initials, a missing middle name, reordered surnames, OCR slips and
 * year-only birth dates are expected; a different person's name is not.
 */
import type { DocumentReport, ExtractedFields, Finding, IdentityClaim } from './types';
import { levenshtein, nameTokens, normalizeGender } from './normalize';
import { adapterFor } from './registry';

function docLabel(d: DocumentReport): string {
  return `${(d.detectedType && adapterFor(d.detectedType)?.label) || 'Document'} #${d.index + 1}`;
}

export type Comparison = 'MATCH' | 'EXPECTED_VARIATION' | 'MISMATCH';

export interface NameComparison {
  result: Comparison;
  confidence: number;
  explanation: string;
}

function tokenMatch(a: string, b: string): 'exact' | 'initial' | 'fuzzy' | null {
  if (a === b) return 'exact';
  if ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))) return 'initial';
  const max = Math.max(a.length, b.length);
  const allowed = max >= 8 ? 2 : max >= 4 ? 1 : 0;
  if (allowed && levenshtein(a, b) <= allowed) return 'fuzzy';
  return null;
}

export function compareNames(aRaw: string, bRaw: string): NameComparison {
  const a = nameTokens(aRaw);
  const b = nameTokens(bRaw);
  if (!a.length || !b.length) return { result: 'MISMATCH', confidence: 0, explanation: 'A name is missing.' };
  if (a.join('') === b.join('')) {
    return a.join(' ') === b.join(' ')
      ? { result: 'MATCH', confidence: 0.98, explanation: 'Names are identical.' }
      : { result: 'EXPECTED_VARIATION', confidence: 0.9, explanation: 'Same letters, different spacing.' };
  }
  if ([...a].sort().join(' ') === [...b].sort().join(' ')) {
    return { result: 'MATCH', confidence: 0.95, explanation: 'Same names in a different order (surname first vs last).' };
  }
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const used = new Set<number>();
  const kinds: string[] = [];
  for (const t of short) {
    let found = -1;
    let kind: ReturnType<typeof tokenMatch> = null;
    for (let i = 0; i < long.length; i++) {
      if (used.has(i)) continue;
      const k = tokenMatch(t, long[i]!);
      if (k && (found < 0 || k === 'exact')) {
        found = i;
        kind = k;
        if (k === 'exact') break;
      }
    }
    if (found < 0) {
      return { result: 'MISMATCH', confidence: 0.1, explanation: `"${t}" does not appear in the other name.` };
    }
    used.add(found);
    kinds.push(kind!);
  }
  const reasons: string[] = [];
  if (kinds.includes('initial')) reasons.push('initials used for part of the name');
  if (kinds.includes('fuzzy')) reasons.push('a small spelling or reading difference');
  if (long.length > short.length) reasons.push(`${long.length - short.length} extra name part(s) on one document (middle name, surname or father's name)`);
  const exactShare = kinds.filter((k) => k === 'exact').length / short.length;
  // A single matching token (e.g. only the first name) is weak evidence.
  if (short.length === 1 && long.length > 1) {
    return { result: 'EXPECTED_VARIATION', confidence: 0.45, explanation: `Only one name part to compare; ${reasons.join('; ')}.` };
  }
  return {
    result: 'EXPECTED_VARIATION',
    confidence: +(0.6 + 0.3 * exactShare).toFixed(2),
    explanation: reasons.length ? `Likely the same person: ${reasons.join('; ')}.` : 'Likely the same person.',
  };
}

interface DobView { full?: string; year?: string }

function dobOf(fields: ExtractedFields): DobView {
  return { full: fields.dateOfBirth?.value, year: fields.yearOfBirth?.value ?? fields.dateOfBirth?.value?.slice(0, 4) };
}

export function compareDob(a: DobView, b: DobView): { result: Comparison; explanation: string } | null {
  if (a.full && b.full) {
    if (a.full === b.full) return { result: 'MATCH', explanation: 'Dates of birth are identical.' };
    const [ay, am, ad] = a.full.split('-');
    const [by, bm, bd] = b.full.split('-');
    if (ay === by && am === bd && ad === bm) {
      return { result: 'MISMATCH', explanation: 'Day and month appear swapped between the documents (possible reading error).' };
    }
    return { result: 'MISMATCH', explanation: 'Dates of birth differ.' };
  }
  if (a.year && b.year) {
    return a.year === b.year
      ? { result: 'EXPECTED_VARIATION', explanation: 'One document shows only the year of birth; the years agree.' }
      : { result: 'MISMATCH', explanation: 'Years of birth differ.' };
  }
  return null;
}

function addressTokens(raw: string): Set<string> {
  return new Set(raw.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 2));
}

export function compareAddress(a: string, b: string): { result: 'MATCH' | 'PARTIAL' | 'MISMATCH'; overlap: number; samePin: boolean } {
  const ta = addressTokens(a);
  const tb = addressTokens(b);
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size || 1;
  const overlap = inter / union;
  const pinA = a.match(/\b(\d{6})\b/)?.[1];
  const pinB = b.match(/\b(\d{6})\b/)?.[1];
  const samePin = Boolean(pinA && pinA === pinB);
  if (overlap >= 0.6) return { result: 'MATCH', overlap, samePin };
  if (overlap >= 0.3 || samePin) return { result: 'PARTIAL', overlap, samePin };
  return { result: 'MISMATCH', overlap, samePin };
}

/** PAN 5th character = first letter of the holder's surname (individual PANs). */
export function panInitialFits(pan: string, name: string): boolean {
  const initial = pan[4];
  const tokens = nameTokens(name);
  if (!initial || !tokens.length) return true;
  return tokens.some((t) => t.startsWith(initial));
}

export function crossDocumentFindings(docs: DocumentReport[], claim: IdentityClaim): { findings: Finding[]; comparedPairs: number } {
  const out: Finding[] = [];
  let comparedPairs = 0;
  const usable = docs.filter((d) => d.detectedType);

  for (let x = 0; x < usable.length; x++) {
    for (let y = x + 1; y < usable.length; y++) {
      const A = usable[x]!;
      const B = usable[y]!;
      comparedPairs++;
      const pair = `${docLabel(A)} vs ${docLabel(B)}`;

      const na = A.fields.fullName?.value;
      const nb = B.fields.fullName?.value;
      if (na && nb) {
        const c = compareNames(na, nb);
        out.push({
          code: c.result === 'MATCH' ? 'NAME_MATCH' : c.result === 'EXPECTED_VARIATION' ? 'NAME_EXPECTED_VARIATION' : 'NAME_MISMATCH',
          severity: c.result === 'MISMATCH' ? 'HIGH' : c.result === 'EXPECTED_VARIATION' ? 'LOW' : 'INFO',
          message: `Name (${pair}): ${c.explanation}`,
          field: 'fullName', evidence: [`confidence ${c.confidence}`],
        });
      }
      const pa = A.fields.fatherOrGuardianName?.value;
      const pb = B.fields.fatherOrGuardianName?.value;
      if (pa && pb) {
        const c = compareNames(pa, pb);
        out.push(c.result === 'MISMATCH'
          ? {
            code: 'PARENT_NAME_MISMATCH', severity: 'LOW', field: 'fatherOrGuardianName',
            message: `Father's / guardian's name (${pair}): differs. Voter IDs may show a husband's name and PAN may show the mother's, so this alone is not a concern.`,
          }
          : { code: 'PARENT_NAME_CONSISTENT', severity: 'INFO', field: 'fatherOrGuardianName', message: `Father's / guardian's name (${pair}): consistent. ${c.explanation}` });
      }
      const d = compareDob(dobOf(A.fields), dobOf(B.fields));
      if (d) {
        out.push({
          code: d.result === 'MATCH' ? 'DOB_MATCH' : d.result === 'EXPECTED_VARIATION' ? 'DOB_EXPECTED_VARIATION' : 'DOB_MISMATCH',
          severity: d.result === 'MISMATCH' ? 'HIGH' : 'INFO',
          message: `Date of birth (${pair}): ${d.explanation}`, field: 'dateOfBirth',
        });
      }
      const ga = normalizeGender(A.fields.gender?.value);
      const gb = normalizeGender(B.fields.gender?.value);
      if (ga && gb) {
        out.push(ga === gb
          ? { code: 'GENDER_MATCH', severity: 'INFO', message: `Gender (${pair}): consistent.`, field: 'gender' }
          : {
            code: 'GENDER_MISMATCH', severity: ga === 'X' || gb === 'X' ? 'MEDIUM' : 'HIGH',
            message: `Gender (${pair}): differs. ${ga === 'X' || gb === 'X' ? 'One document may reflect an updated gender marker.' : 'This needs review.'}`,
            field: 'gender',
          });
      }
      const aa = A.fields.address?.value;
      const ab = B.fields.address?.value;
      if (aa && ab) {
        const c = compareAddress(aa, ab);
        out.push({
          code: c.result === 'MATCH' ? 'ADDRESS_MATCH' : c.result === 'PARTIAL' ? 'ADDRESS_PARTIAL' : 'ADDRESS_MISMATCH',
          severity: c.result === 'MISMATCH' ? 'LOW' : 'INFO',
          message: `Address (${pair}): ${c.result === 'MATCH' ? 'consistent' : c.result === 'PARTIAL' ? `partly consistent${c.samePin ? ' (same PIN code)' : ''}; addresses often differ when one document is older` : 'different; people move, so this alone is not a concern'}.`,
          field: 'address', evidence: [`overlap ${(c.overlap * 100).toFixed(0)}%`],
        });
      }
      if (A.fields.documentNumber && B.fields.documentNumber && A.detectedType === B.detectedType
        && A.fields.documentNumber.value === B.fields.documentNumber.value) {
        out.push({ code: 'SAME_DOCUMENT_TWICE', severity: 'LOW', message: `${pair}: the same document was submitted twice; it counts once.` });
      }
    }
  }

  // PAN surname initial against any readable name.
  for (const d of usable.filter((x) => x.detectedType === 'PAN')) {
    const pan = d.fields.documentNumber?.value;
    if (!pan || pan[3] !== 'P') continue;
    const names = [d.fields.fullName?.value, ...usable.filter((x) => x !== d).map((x) => x.fields.fullName?.value), claim.fullName]
      .filter((n): n is string => Boolean(n));
    if (!names.length) continue;
    const fits = names.some((n) => panInitialFits(pan, n));
    out.push(fits
      ? { code: 'PAN_SURNAME_INITIAL_MATCH', severity: 'INFO', message: "PAN: the 5th character matches the holder's surname initial.", documentIndex: d.index }
      : { code: 'PAN_SURNAME_INITIAL_MISMATCH', severity: 'MEDIUM', message: "PAN: the 5th character does not match the initial of any name part. The PAN may belong to someone else, or the name was misread.", documentIndex: d.index });
  }

  // The claim against each document.
  for (const d of usable) {
    if (claim.fullName && d.fields.fullName) {
      const c = compareNames(claim.fullName, d.fields.fullName.value);
      out.push({
        code: c.result === 'MATCH' ? 'NAME_MATCH' : c.result === 'EXPECTED_VARIATION' ? 'NAME_EXPECTED_VARIATION' : 'NAME_MISMATCH',
        severity: c.result === 'MISMATCH' ? 'HIGH' : 'INFO',
        message: `Name (your profile vs ${docLabel(d)}): ${c.explanation}`,
        documentIndex: d.index, field: 'fullName', evidence: [`confidence ${c.confidence}`],
      });
    }
    if (claim.dateOfBirth) {
      const c = compareDob({ full: claim.dateOfBirth, year: claim.dateOfBirth.slice(0, 4) }, dobOf(d.fields));
      if (c) {
        out.push({
          code: c.result === 'MATCH' ? 'DOB_MATCH' : c.result === 'EXPECTED_VARIATION' ? 'DOB_EXPECTED_VARIATION' : 'DOB_MISMATCH',
          severity: c.result === 'MISMATCH' ? 'HIGH' : 'INFO',
          message: `Date of birth (your profile vs ${docLabel(d)}): ${c.explanation}`,
          documentIndex: d.index, field: 'dateOfBirth',
        });
      }
    }
  }
  return { findings: out, comparedPairs };
}
