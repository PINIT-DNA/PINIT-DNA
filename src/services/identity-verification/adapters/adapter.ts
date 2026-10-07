/**
 * Document adapter contract. One adapter per document type; the pipeline never
 * switches on document type. To support a new document, add an adapter file and
 * register it in registry.ts.
 */
import type {
  DocumentElement, ElementReport, ExtractedField, ExtractedFields, FieldName, FieldSource, Finding, IdentityDocumentType,
} from '../types';

export interface AdapterContext {
  now: Date;
  documentIndex: number;
}

export interface Detection {
  /** 0..1. Above DETECTION_THRESHOLD the adapter claims the document. */
  score: number;
  /** Which distinctive features were seen (labels, never values). */
  evidence: string[];
}

export interface DocumentAdapter {
  type: IdentityDocumentType;
  label: string;
  /** Fields this document normally carries. */
  expectedFields: FieldName[];
  /** Fields without which the document cannot support an identity claim. */
  requiredFields: FieldName[];
  /** Non-text parts this document normally carries (photo, signature, MRZ). */
  expectedElements: DocumentElement[];
  hasExpiry: boolean;
  /** False for the fallback adapter: its structure is not known, so it can only be reviewed. */
  structureKnown: boolean;
  detect(text: string): Detection;
  extract(text: string, ctx: AdapterContext): ExtractedFields;
  /** Checksums, structure and date logic for this document type. */
  validate(fields: ExtractedFields, ctx: AdapterContext, text: string): Finding[];
  /** Elements this adapter can read from text (e.g. the passport MRZ). Photo and signature are generic. */
  readElements?(text: string): Partial<Record<DocumentElement, ElementReport>>;
}

export const DETECTION_THRESHOLD = 0.45;

export function field(value: string, confidence: number, source: FieldSource): ExtractedField {
  return { value, confidence: Math.max(0, Math.min(1, confidence)), source };
}

/** Score = share of weighted features present, capped at 1. */
export function scoreFeatures(text: string, features: Array<{ label: string; pattern: RegExp; weight: number }>): Detection {
  let score = 0;
  const evidence: string[] = [];
  for (const f of features) {
    if (f.pattern.test(text)) {
      score += f.weight;
      evidence.push(f.label);
    }
  }
  return { score: Math.min(1, score), evidence };
}

/** Labels that end a free-text value (a name runs until the next label). */
const STOP_WORDS = /^(FATHER|FATHERS|MOTHER|MOTHERS|HUSBAND|GUARDIAN|S|D|W|SO|DO|WO|DOB|DATE|BIRTH|YEAR|GENDER|SEX|MALE|FEMALE|ADDRESS|ISSUE|ISSUED|VALID|EXPIRY|SIGNATURE|NATIONALITY|PERMANENT|ACCOUNT|NUMBER|NO|ELECTOR|ELECTORS|AGE|BLOOD|GROUP|COV|PLACE|OF|INCOME|TAX|DEPARTMENT|GOVT|GOVERNMENT|INDIA|REPUBLIC)$/;

/**
 * Reads up to `maxWords` name-like words after a label such as "Name:".
 * Stops at the next known label or at anything that is not a word.
 */
export function wordsAfter(text: string, label: RegExp, maxWords = 4): string | null {
  const m = text.match(label);
  if (!m || m.index === undefined) return null;
  const rest = text.slice(m.index + m[0].length).replace(/^[\s:/\-.]+/, '');
  const words: string[] = [];
  for (const token of rest.split(/\s+/)) {
    const clean = token.replace(/[^A-Za-z.]/g, '');
    if (!clean || clean !== token.replace(/[,;:]$/, '')) break;
    const bare = clean.replace(/\./g, '');
    if (!bare) break;
    if (STOP_WORDS.test(bare.toUpperCase())) break;
    words.push(clean);
    if (words.length >= maxWords) break;
  }
  return words.length ? words.join(' ') : null;
}

/** First date after a label, e.g. "DOB: 01/01/2000" or "Date of Expiry 12-05-2031". */
export function dateAfter(text: string, label: RegExp, window = 40): string | null {
  const m = text.match(label);
  if (!m || m.index === undefined) return null;
  const slice = text.slice(m.index + m[0].length, m.index + m[0].length + window);
  const d = slice.match(/(\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-\s][A-Za-z]{3,4}[-\s,]*\d{4})/);
  return d ? d[1]! : null;
}

export function genderIn(text: string): string | null {
  const m = text.match(/\b(MALE|FEMALE|TRANSGENDER)\b/i) || text.match(/(?:sex|gender)\s*[:/]?\s*([MFX])\b/i);
  return m ? m[1]!.toUpperCase() : null;
}

export function missingRequired(adapter: DocumentAdapter, fields: ExtractedFields, documentIndex: number): Finding[] {
  return adapter.requiredFields
    .filter((f) => !fields[f])
    .map((f) => ({
      code: 'MISSING_FIELD' as const,
      severity: 'MEDIUM' as const,
      message: `${adapter.label}: could not read the ${humanField(f)}.`,
      documentIndex,
      field: f,
    }));
}

export function humanField(f: FieldName): string {
  const names: Record<FieldName, string> = {
    fullName: 'name', fatherOrGuardianName: "father's or guardian's name", dateOfBirth: 'date of birth',
    motherName: "mother's name", electoralConstituency: 'assembly constituency', electoralPartNumber: 'part number',
    yearOfBirth: 'year of birth', gender: 'gender', documentNumber: 'document number', nationality: 'nationality',
    address: 'address', issueDate: 'issue date', expiryDate: 'expiry date', issuingAuthority: 'issuing authority',
    issuingCountry: 'issuing country', placeOfBirth: 'place of birth', vehicleClasses: 'vehicle classes',
    virtualId: 'virtual ID',
  };
  return names[f];
}
