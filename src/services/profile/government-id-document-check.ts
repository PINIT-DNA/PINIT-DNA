/**
 * Document checks for a government-ID upload.
 * Face match is a separate gate and is not decided here.
 * Passing these checks does not mean a government or KYC provider verified the document.
 */
import { identityTypeForUpload, type GovernmentDocumentType } from './government-id-status';
import { classify } from '../identity-verification/registry';

export const DOCUMENT_CHECK_STATES = [
  'DOCUMENT_UPLOADED',
  'DOCUMENT_TYPE_VALIDATED',
  'FACE_BOUND',
  'DOCUMENT_VERIFIED',
] as const;

export type DocumentCheckState = (typeof DOCUMENT_CHECK_STATES)[number];

export type DocumentRejectReason = 'CORRUPT' | 'UNSUPPORTED' | 'UNRELATED' | 'WRONG_TYPE' | 'FACE_REQUIRED' | 'PASSWORD_PROTECTED';

/** e-Aadhaar and many bank/government PDFs are password-locked; their text cannot be read. */
export function isPasswordProtectedPdf(bytes: Buffer): boolean {
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return false;
  return /\/Encrypt\s/.test(bytes.toString('latin1'));
}

export interface DocumentReview {
  ok: boolean;
  reached: DocumentCheckState[];
  /** Always false until a document-verification provider is integrated. */
  documentVerified: false;
  reason?: DocumentRejectReason;
  message?: string;
}

/** Upload choices that the classifier may resolve to any of these families. */
const OTHER_GOVERNMENT_ID_FAMILY = new Set(['AADHAAR', 'VOTER_ID', 'PAN', 'GOVERNMENT_ID']);

/** Structural integrity. A matching header alone is not enough. */
export function fileIsIntact(mime: string, bytes: Buffer): boolean {
  if (mime === 'application/pdf') {
    if (bytes.length < 64) return false;
    const head = bytes.subarray(0, Math.min(bytes.length, 16)).toString('latin1');
    if (!head.startsWith('%PDF-')) return false;
    const tail = bytes.subarray(Math.max(0, bytes.length - 4096)).toString('latin1');
    return tail.includes('%%EOF') && (tail.includes('startxref') || tail.includes('trailer'));
  }
  if (mime === 'image/jpeg') {
    if (bytes.length < 32) return false;
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
    return bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (mime === 'image/png') {
    if (bytes.length < 32) return false;
    const png = bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG';
    return png && bytes.subarray(bytes.length - 8).toString('ascii').includes('IEND');
  }
  if (mime === 'image/webp') {
    if (bytes.length < 16) return false;
    return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  }
  return false;
}

function reject(reason: DocumentRejectReason, message: string, reached: DocumentCheckState[] = []): DocumentReview {
  return { ok: false, reached, documentVerified: false, reason, message };
}

/**
 * Advance the document pipeline. DOCUMENT_VERIFIED is never reached here.
 * ok is true when the file matches the selected type. FACE_BOUND is added only if a face seal was given.
 */
export function reviewGovernmentDocument(input: {
  claimedType: GovernmentDocumentType;
  mime: string | null;
  bytes: Buffer;
  extractedText: string;
  faceBound: boolean;
}): DocumentReview {
  if (!input.mime || !fileIsIntact(input.mime, input.bytes)) {
    const unsupported = !input.mime;
    return reject(
      unsupported ? 'UNSUPPORTED' : 'CORRUPT',
      unsupported
        ? 'Use a JPG, PNG, WEBP, or PDF of the document.'
        : 'This file is damaged or incomplete. Choose another photo or PDF of the ID.',
    );
  }

  const reached: DocumentCheckState[] = ['DOCUMENT_UPLOADED'];
  if (input.mime === 'application/pdf' && isPasswordProtectedPdf(input.bytes)) {
    return reject(
      'PASSWORD_PROTECTED',
      'This PDF is locked with a password (e-Aadhaar PDFs are). Upload a photo or screenshot of the card instead, or use Scan with camera.',
      reached,
    );
  }
  const text = input.extractedText.replace(/\s+/g, ' ').trim();
  const words = text.split(' ').filter(Boolean);
  if (words.length < 2) {
    return reject(
      'UNRELATED',
      'This file does not contain a readable passport, national ID, or driver\'s license.',
      reached,
    );
  }

  // Same document adapters the identity-verification pipeline uses.
  const target = identityTypeForUpload(input.claimedType);
  const c = classify(text, target);
  if (!c.type) {
    return reject(
      'UNRELATED',
      'This file does not look like the selected government ID.',
      reached,
    );
  }
  const fits = target ? c.type === target && !c.declaredMismatch : OTHER_GOVERNMENT_ID_FAMILY.has(c.type);
  if (!fits) {
    return reject(
      'WRONG_TYPE',
      'This file does not match the document type you selected.',
      reached,
    );
  }

  reached.push('DOCUMENT_TYPE_VALIDATED');
  // A face check is optional extra evidence. The product collects the proof
  // document itself; a live face scan is not required to add one.
  if (input.faceBound) reached.push('FACE_BOUND');
  return { ok: true, reached, documentVerified: false };
}

/** The furthest check a stored row may claim. DOCUMENT_VERIFIED is never written here. */
export function storedDocumentState(review: DocumentReview): DocumentCheckState | null {
  if (!review.ok) return null;
  if (review.reached.includes('DOCUMENT_VERIFIED')) return null;
  if (review.reached.includes('FACE_BOUND')) return 'FACE_BOUND';
  return review.reached.includes('DOCUMENT_TYPE_VALIDATED') ? 'DOCUMENT_TYPE_VALIDATED' : null;
}

export function checksFromStoredState(state: string | null | undefined): {
  documentUploaded: boolean;
  documentTypeValidated: boolean;
  faceBound: boolean;
  documentVerified: boolean;
} {
  if (state === 'DOCUMENT_VERIFIED') {
    return { documentUploaded: true, documentTypeValidated: true, faceBound: true, documentVerified: true };
  }
  if (state === 'FACE_BOUND') {
    return { documentUploaded: true, documentTypeValidated: true, faceBound: true, documentVerified: false };
  }
  if (state === 'DOCUMENT_TYPE_VALIDATED') {
    return { documentUploaded: true, documentTypeValidated: true, faceBound: false, documentVerified: false };
  }
  if (state === 'DOCUMENT_UPLOADED') {
    return { documentUploaded: true, documentTypeValidated: false, faceBound: false, documentVerified: false };
  }
  return { documentUploaded: false, documentTypeValidated: false, faceBound: false, documentVerified: false };
}

/** On file = a document that passed the type check is stored. Face binding is not required. */
export function mayListGovernmentIdOnFile(state: string | null | undefined): boolean {
  return checksFromStoredState(state).documentTypeValidated;
}

/** The profile phrase. A KYC provider is required before any "verified" wording. */
export function profileGovernmentIdPhrase(state: string | null | undefined): 'Government ID on file' | null {
  if (!mayListGovernmentIdOnFile(state)) return null;
  return 'Government ID on file';
}
