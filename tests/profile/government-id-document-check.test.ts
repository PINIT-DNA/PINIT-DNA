import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractGovernmentDocumentText } from '../../src/services/profile/government-id-text';
import {
  isPasswordProtectedPdf,
  mayListGovernmentIdOnFile,
  profileGovernmentIdPhrase,
  reviewGovernmentDocument,
  storedDocumentState,
  type DocumentReview,
} from '../../src/services/profile/government-id-document-check';
import type { GovernmentDocumentType } from '../../src/services/profile/government-id-status';

async function pdfWithText(text: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 50, y: 700, size: 12, font });
  return Buffer.from(await doc.save());
}

async function reviewPdf(text: string, claimedType: GovernmentDocumentType, faceBound = true): Promise<DocumentReview> {
  const bytes = await pdfWithText(text);
  const extractedText = await extractGovernmentDocumentText('application/pdf', bytes);
  expect(extractedText.toLowerCase()).toContain(text.slice(0, 8).toLowerCase());
  return reviewGovernmentDocument({
    claimedType,
    mime: 'application/pdf',
    bytes,
    extractedText,
    faceBound,
  });
}

describe('government id document check', () => {
  const passport = 'PASSPORT Surname Nationality Date of birth';
  const national = 'National identity card Date of birth Identity number Republic of India';
  const license = "Driver's license Licence no Date of birth";

  it('accepts valid-looking supported IDs only as on file, never as verified', async () => {
    for (const [type, text] of [
      ['PASSPORT', passport],
      ['NATIONAL_ID', national],
      ['DRIVERS_LICENSE', license],
    ] as const) {
      const review = await reviewPdf(text, type);
      expect(review.ok).toBe(true);
      expect(review.reached).toEqual(['DOCUMENT_UPLOADED', 'DOCUMENT_TYPE_VALIDATED', 'FACE_BOUND']);
      expect(review.reached).not.toContain('DOCUMENT_VERIFIED');
      expect(review.documentVerified).toBe(false);
      expect(profileGovernmentIdPhrase('FACE_BOUND')).toBe('Government ID on file');
      expect(profileGovernmentIdPhrase('FACE_BOUND')?.toLowerCase()).not.toContain('verif');
    }
  });

  it('rejects a random PDF after the file is uploaded', async () => {
    const review = await reviewPdf('Qwerty notes about the weather and a shopping list of apples', 'PASSPORT');
    expect(review.ok).toBe(false);
    expect(review.reason).toBe('UNRELATED');
    expect(review.reached).toEqual(['DOCUMENT_UPLOADED']);
    expect(profileGovernmentIdPhrase('DOCUMENT_UPLOADED')).toBeNull();
  });

  it('rejects an unrelated PDF such as an invoice', async () => {
    const review = await reviewPdf('Invoice number 44 Amount due please pay the total today', 'NATIONAL_ID');
    expect(review.ok).toBe(false);
    expect(review.reason).toBe('UNRELATED');
    expect(review.reached).not.toContain('DOCUMENT_TYPE_VALIDATED');
  });

  it('rejects a corrupted PDF before upload state', async () => {
    const bytes = Buffer.from('%PDF-1.4\nthis file is cut off');
    const review = reviewGovernmentDocument({
      claimedType: 'PASSPORT',
      mime: 'application/pdf',
      bytes,
      extractedText: passport,
      faceBound: true,
    });
    expect(review.ok).toBe(false);
    expect(review.reason).toBe('CORRUPT');
    expect(review.reached).toEqual([]);
  });

  it('rejects a passport file selected as a driver license', async () => {
    const review = await reviewPdf(passport, 'DRIVERS_LICENSE');
    expect(review.ok).toBe(false);
    expect(review.reason).toBe('WRONG_TYPE');
    expect(review.reached).toEqual(['DOCUMENT_UPLOADED']);
  });

  it('rejects unsupported formats', () => {
    const review = reviewGovernmentDocument({
      claimedType: 'PASSPORT',
      mime: null,
      bytes: Buffer.from('PK\u0003\u0004 this is a word document about passports'),
      extractedText: passport,
      faceBound: true,
    });
    expect(review.ok).toBe(false);
    expect(review.reason).toBe('UNSUPPORTED');
    expect(profileGovernmentIdPhrase('DOCUMENT_VERIFIED')?.toLowerCase()).not.toContain('verif');
  });

  it('does not accept a photo that has no readable ID text', () => {
    const jpeg = Buffer.alloc(40, 0);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[38] = 0xff;
    jpeg[39] = 0xd9;
    const review = reviewGovernmentDocument({
      claimedType: 'PASSPORT',
      mime: 'image/jpeg',
      bytes: jpeg,
      extractedText: '',
      faceBound: true,
    });
    expect(review.ok).toBe(false);
    expect(review.reason).toBe('UNRELATED');
    expect(review.reached).toEqual(['DOCUMENT_UPLOADED']);
  });

  it('accepts a matching document without a face check and lists it as on file', async () => {
    const review = await reviewPdf(passport, 'PASSPORT', false);
    expect(review.ok).toBe(true);
    expect(review.reached).toEqual(['DOCUMENT_UPLOADED', 'DOCUMENT_TYPE_VALIDATED']);
    expect(storedDocumentState(review)).toBe('DOCUMENT_TYPE_VALIDATED');
    expect(mayListGovernmentIdOnFile('DOCUMENT_TYPE_VALIDATED')).toBe(true);
    expect(review.documentVerified).toBe(false);
  });

  it('still records face binding when a face check was given', async () => {
    const review = await reviewPdf(passport, 'PASSPORT', true);
    expect(storedDocumentState(review)).toBe('FACE_BOUND');
    expect(mayListGovernmentIdOnFile('FACE_BOUND')).toBe(true);
  });

  // A sample that only resembles Aadhaar layout. The name and number are invented.
  const aadhaarPhotoText = 'Government of India Test Person DOB: 01/01/2000 FEMALE 1234 5678 9012';
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(40, 1), Buffer.from([0xff, 0xd9])]);

  it('recognises an Aadhaar card photo as a national ID', () => {
    const review = reviewGovernmentDocument({
      claimedType: 'NATIONAL_ID', mime: 'image/jpeg', bytes: jpeg, extractedText: aadhaarPhotoText, faceBound: false,
    });
    expect(review.ok).toBe(true);
    expect(storedDocumentState(review)).toBe('DOCUMENT_TYPE_VALIDATED');
  });

  it('recognises a masked Aadhaar number and the UIDAI issuer line', () => {
    const review = reviewGovernmentDocument({
      claimedType: 'NATIONAL_ID', mime: 'image/jpeg', bytes: jpeg,
      extractedText: 'Unique Identification Authority of India XXXX XXXX 9012 Test Person', faceBound: false,
    });
    expect(review.ok).toBe(true);
  });

  it('does not accept Aadhaar text as a passport or driving licence', () => {
    for (const claimedType of ['PASSPORT', 'DRIVERS_LICENSE'] as const) {
      const review = reviewGovernmentDocument({
        claimedType, mime: 'image/jpeg', bytes: jpeg, extractedText: aadhaarPhotoText, faceBound: false,
      });
      expect(review.ok).toBe(false);
    }
  });

  it('explains a password-locked PDF instead of calling it unrelated', () => {
    const locked = Buffer.from(
      '%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n'
      + 'trailer << /Root 1 0 R /Encrypt 5 0 R /Size 6 >>\nstartxref\n0\n%%EOF\n',
      'latin1',
    );
    expect(isPasswordProtectedPdf(locked)).toBe(true);
    const review = reviewGovernmentDocument({
      claimedType: 'NATIONAL_ID', mime: 'application/pdf', bytes: locked, extractedText: '', faceBound: false,
    });
    expect(review.ok).toBe(false);
    expect(review.reason).toBe('PASSWORD_PROTECTED');
    expect(review.message).toMatch(/password/i);
  });

  it('never lists an unchecked upload as on file', () => {
    expect(mayListGovernmentIdOnFile('DOCUMENT_UPLOADED')).toBe(false);
    expect(mayListGovernmentIdOnFile(null)).toBe(false);
  });
});
