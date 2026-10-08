/**
 * A sharpness warning is recorded, but it does not skip OCR. A clear rendered
 * card is read. An image with no extracted text is not "checks passed".
 */
import sharp from 'sharp';
import { collectFileSignals, imageUnclear, UNCLEAR_DOCUMENT } from '../../src/services/identity-verification/authenticity';
import { runIdentityVerification } from '../../src/services/identity-verification/pipeline';
import { extractGovernmentDocumentText } from '../../src/services/profile/government-id-text';
import { verhoeffCheckDigit } from '../../src/services/identity-verification/checksums';
import type { DocumentInput } from '../../src/services/identity-verification/types';

const prefix = '23456789012';
const AADHAAR = prefix + verhoeffCheckDigit(prefix);
const GROUPED = AADHAAR.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');

async function cardPng(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900">
    <rect width="100%" height="100%" fill="#f4f4f4"/>
    <text x="60" y="160" font-size="54" font-family="Arial" fill="#111">GOVERNMENT OF INDIA</text>
    <text x="60" y="260" font-size="54" font-family="Arial" fill="#111">Aadhaar</text>
    <text x="60" y="360" font-size="48" font-family="Arial" fill="#111">Name Test Reddy</text>
    <text x="60" y="460" font-size="48" font-family="Arial" fill="#111">DOB: 01/01/2000 FEMALE</text>
    <text x="60" y="560" font-size="56" font-family="Arial" fill="#111">${GROUPED}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function run(documents: DocumentInput[], extra: { fingerprintsOnOtherAccounts?: Set<string> } = {}) {
  return runIdentityVerification({
    now: new Date('2026-10-07T00:00:00Z'),
    claim: { userId: 'user-1', fullName: 'Test Reddy' },
    documents,
    ...extra,
  });
}

describe('document image quality', () => {
  it('reads a sharp rendered card, and still attempts OCR when the picture is soft or dark', async () => {
    const clear = await cardPng();
    const clearSignals = await collectFileSignals('image/png', clear);
    expect(clearSignals.intact).toBe(true);
    expect(clearSignals.widthPx).toBeGreaterThan(500);
    expect(imageUnclear(clearSignals)).toBe(false);

    const blurred = await sharp(clear).blur(8).png().toBuffer();
    const blurSignals = await collectFileSignals('image/png', blurred);
    expect(imageUnclear(blurSignals)).toBe(true);

    const dark = await sharp(clear).modulate({ brightness: 0.05 }).png().toBuffer();
    expect(imageUnclear(await collectFileSignals('image/png', dark))).toBe(true);

    const soft = await extractGovernmentDocumentText('image/png', blurred);
    expect(soft.unclear).toBeFalsy();

    const read = await extractGovernmentDocumentText('image/png', clear);
    expect(read.unclear).toBeFalsy();
    expect(read.text.toLowerCase()).toMatch(/aadhaar|reddy|government/);
  }, 90000);

  it('does not mark an unread image as checks passed, and flags a duplicate number', () => {
    const unread = run([{
      mimeType: 'image/png',
      bytes: Buffer.from('not-used'),
      extractedText: '',
      fileSignals: { intact: true, unclear: true, widthPx: 1400, heightPx: 900, sharpness: 2 },
    }]);
    expect(unread.status).not.toBe('CHECKS_PASSED');
    expect(unread.reasons[0]).toBe(UNCLEAR_DOCUMENT);
    expect(unread.stages.some((s) => s.findings.some((f) => f.code === 'TEXT_UNREADABLE'))).toBe(true);

    const duplicate = run(
      [{
        mimeType: 'image/png',
        bytes: Buffer.alloc(0),
        extractedText: `Government of India Aadhaar Test Reddy DOB: 01/01/2000 FEMALE ${GROUPED}`,
        declaredType: 'AADHAAR',
        fileSignals: { intact: true, widthPx: 1400, heightPx: 900, sharpness: 80 },
        numberFingerprint: 'fp-same',
      }],
      { fingerprintsOnOtherAccounts: new Set(['fp-same']) },
    );
    expect(duplicate.status).not.toBe('CHECKS_PASSED');
    const dup = duplicate.stages.flatMap((s) => s.findings).find((f) => f.code === 'DUPLICATE_DOCUMENT_OTHER_ACCOUNT');
    expect(dup?.message).toBe('This identity document is already associated with another PINIT account.');
  });
});
