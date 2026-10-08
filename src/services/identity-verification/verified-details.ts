/**
 * The details read from a verified ID (name, number, date of birth, gender,
 * address), kept encrypted next to the saved document so they can be used for
 * later verification. Pure helpers only: building, masking and naming.
 * Encryption and storage live in the service that calls these.
 *
 * Only values that were read cleanly are kept. A value flagged for review or
 * invalid is left out rather than stored as if it were right.
 */
import type { ExtractedFields, FieldName, IdentityDocumentType, VerificationResult } from './types';

export interface VerifiedDocumentDetails {
  type: IdentityDocumentType;
  fields: Partial<Record<FieldName, string>>;
}

export interface VerifiedIdentityData {
  version: 1;
  verifiedAt: string;
  runId: string | null;
  fullName: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  /** The number of the first document that carries one, in full. Owner-only, on request. */
  documentNumber: string | null;
  primaryType: IdentityDocumentType | null;
  documents: VerifiedDocumentDetails[];
  /** True when the owner corrected the address by hand after reading it. */
  addressEditedByOwner?: boolean;
}

const CLEAN: ReadonlyArray<string> = ['READ', 'VALIDATED'];

function cleanValues(fields: ExtractedFields): Partial<Record<FieldName, string>> {
  const out: Partial<Record<FieldName, string>> = {};
  for (const [name, field] of Object.entries(fields) as Array<[FieldName, ExtractedFields[FieldName]]>) {
    if (!field?.value) continue;
    if (field.status && !CLEAN.includes(field.status)) continue;
    out[name] = field.value;
  }
  return out;
}

/** A name printed in capitals (PAN, passport) is shown in normal case. Mixed case is left alone. */
export function tidyName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name && name === name.toUpperCase() && /[A-Z]/.test(name)) {
    return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
  }
  return name;
}

/** Builds what is stored. Returns null unless the identity checks passed and something was read. */
export function buildVerifiedIdentityData(result: VerificationResult, runId: string | null, now: Date): VerifiedIdentityData | null {
  if (result.status !== 'CHECKS_PASSED') return null;
  const documents: VerifiedDocumentDetails[] = [];
  for (const d of result.documents) {
    if (!d.detectedType) continue;
    const fields = cleanValues(d.fields);
    if (Object.keys(fields).length) documents.push({ type: d.detectedType, fields });
  }
  if (!documents.length) return null;
  const first = (name: FieldName): string | null => documents.map((d) => d.fields[name]).find((v): v is string => Boolean(v)) ?? null;
  const name = first('fullName');
  const numbered = documents.find((d) => d.fields.documentNumber);
  return {
    version: 1,
    verifiedAt: now.toISOString(),
    runId,
    fullName: name ? tidyName(name) : null,
    dateOfBirth: first('dateOfBirth'),
    gender: first('gender'),
    address: first('address'),
    documentNumber: numbered?.fields.documentNumber ?? null,
    primaryType: numbered?.type ?? documents[0]!.type,
    documents,
  };
}

/** 5472 7945 1580 → ••••••••1580. The last four are enough to recognise a number. */
export function maskNumber(value: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, '');
  if (compact.length <= 4) return '•'.repeat(compact.length);
  return `${'•'.repeat(compact.length - 4)}${compact.slice(-4)}`;
}

/** 2005-07-28 → ••/••/2005 */
export function maskDate(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-\d{2}-\d{2}$/);
  return m ? `••/••/${m[1]}` : value.replace(/\d/g, '•');
}

/** Keeps the first line's place name only; street, house and postcode details are hidden. */
export function maskAddress(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return '••••••••';
  return `••••••••, ${parts.slice(-2).join(', ').replace(/\b\d{6}\b/, '••••••')}`;
}

export interface VerifiedDetailsView {
  documentType: IdentityDocumentType | null;
  verifiedAt: string;
  revealed: boolean;
  addressEditedByOwner: boolean;
  fullName: string | null;
  documentNumber: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
}

/** What the signed-in owner sees. Sensitive values are masked unless they ask to reveal them. */
export function viewVerifiedDetails(data: VerifiedIdentityData, reveal: boolean): VerifiedDetailsView {
  return {
    documentType: data.primaryType,
    verifiedAt: data.verifiedAt,
    revealed: reveal,
    addressEditedByOwner: Boolean(data.addressEditedByOwner),
    fullName: data.fullName,
    documentNumber: reveal ? data.documentNumber : maskNumber(data.documentNumber),
    dateOfBirth: reveal ? data.dateOfBirth : maskDate(data.dateOfBirth),
    gender: data.gender,
    address: reveal ? data.address : maskAddress(data.address),
  };
}
