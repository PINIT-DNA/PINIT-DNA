/**
 * Document presence and live-face binding are separate claims.
 * ON_FILE means a document is sealed to the account. It is not a KYC verdict.
 */

/** NATIONAL_ID is the "other government ID" choice; the classifier decides which family it is. */
export const GOVERNMENT_DOCUMENT_TYPES = ['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE', 'AADHAAR', 'PAN', 'VOTER_ID'] as const;
export type GovernmentDocumentType = (typeof GOVERNMENT_DOCUMENT_TYPES)[number];

/** The identity-verification adapter for an upload choice. Null = let the classifier decide. */
export function identityTypeForUpload(type: GovernmentDocumentType): 'PASSPORT' | 'DRIVING_LICENCE' | 'AADHAAR' | 'PAN' | 'VOTER_ID' | null {
  if (type === 'PASSPORT') return 'PASSPORT';
  if (type === 'DRIVERS_LICENSE') return 'DRIVING_LICENCE';
  if (type === 'AADHAAR' || type === 'PAN' || type === 'VOTER_ID') return type;
  return null;
}

export type DocumentPresence = 'NOT_ADDED' | 'ON_FILE';
export type FaceBindingStatus = 'MATCHED' | 'NOT_MATCHED' | 'REQUIRES_RECHECK';

/** A stored MATCHED result is only current for this long. After that the live face must be checked again. */
export const FACE_BINDING_FRESH_MS = 15 * 60 * 1000;

export const PUBLIC_GOVERNMENT_ID_LABEL = 'Government ID on file';

export function isGovernmentDocumentType(value: string): value is GovernmentDocumentType {
  return (GOVERNMENT_DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function documentTypeLabel(type: string): string {
  if (type === 'PASSPORT') return 'Passport';
  if (type === 'NATIONAL_ID') return 'National ID';
  if (type === 'DRIVERS_LICENSE') return "Driver's license";
  if (type === 'AADHAAR') return 'Aadhaar';
  if (type === 'PAN') return 'PAN card';
  if (type === 'VOTER_ID') return 'Voter ID';
  return 'Government ID';
}

/**
 * MATCHED and NOT_MATCHED describe the last live-face check only.
 * A stale check becomes REQUIRES_RECHECK. It never means the document expired.
 */
export function effectiveFaceBinding(input: {
  stored: string | null | undefined;
  checkedAt: Date | null | undefined;
  now?: number;
}): FaceBindingStatus {
  if (!input.checkedAt) return 'REQUIRES_RECHECK';
  const age = (input.now ?? Date.now()) - input.checkedAt.getTime();
  if (!Number.isFinite(age) || age > FACE_BINDING_FRESH_MS) return 'REQUIRES_RECHECK';
  if (input.stored === 'MATCHED' || input.stored === 'NOT_MATCHED') return input.stored;
  return 'REQUIRES_RECHECK';
}

/** The only government-ID fact a public profile may show. */
export function publicGovernmentIdLabel(onFile: boolean): typeof PUBLIC_GOVERNMENT_ID_LABEL | null {
  return onFile ? PUBLIC_GOVERNMENT_ID_LABEL : null;
}

const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);

export function sniffGovernmentDocument(mime: string, bytes: Buffer): string | null {
  const type = mime.toLowerCase();
  if (!ALLOWED.has(type) || bytes.length < 12) return null;
  if ((type === 'image/jpeg' || type === 'image/jpg') && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (type === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (type === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (type === 'application/pdf' && bytes.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
