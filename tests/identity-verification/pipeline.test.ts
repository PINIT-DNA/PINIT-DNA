/** Cross-ID matching, authenticity signals and end-to-end pipeline decisions. Invented data only. */
import sharp from 'sharp';
import { compareAddress, compareDob, compareNames } from '../../src/services/identity-verification/cross-document';
import { authenticityFindings, BLUR_THRESHOLD, collectFileSignals } from '../../src/services/identity-verification/authenticity';
import { runIdentityVerification } from '../../src/services/identity-verification/pipeline';
import { verhoeffCheckDigit } from '../../src/services/identity-verification/checksums';
import { STAGE_ORDER, type DocumentInput, type PipelineContext } from '../../src/services/identity-verification/types';

const NOW = new Date('2026-10-07T00:00:00Z');
const prefix = '23456789012';
const AADHAAR = prefix + verhoeffCheckDigit(prefix);
const AADHAAR_GROUPED = AADHAAR.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');

const aadhaarText = `Government of India Test Reddy DOB: 01/01/2000 FEMALE ${AADHAAR_GROUPED}`;
const panText = "INCOME TAX DEPARTMENT GOVT. OF INDIA Permanent Account Number Card ABCPR1234F Name / TEST REDDY Father's Name / SAMPLE REDDY Date of Birth 01/01/2000 Signature";
const ICAO_SPECIMEN = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<< L898902C36UTO7408122F1204159ZE184226B<<<<<10';

function doc(extractedText: string, extra: Partial<DocumentInput> = {}): DocumentInput {
  return { mimeType: 'image/jpeg', bytes: Buffer.alloc(0), extractedText, fileSignals: { intact: true, widthPx: 1200, heightPx: 800, sharpness: 120 }, ...extra };
}

function embedding(seed: number): number[] {
  let x = seed;
  return Array.from({ length: 128 }, () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648 - 0.5;
  });
}
function near(e: number[], amount = 0.01): number[] {
  return e.map((v, i) => v + (i % 2 ? amount : -amount));
}
const docFace = (e: number[]) => ({ embedding: e, detectionScore: 0.9, relativeSize: 0.2 });

function run(partial: Partial<PipelineContext>) {
  return runIdentityVerification({
    now: NOW,
    claim: { userId: 'user-1', fullName: 'Test Reddy' },
    documents: [],
    ...partial,
  });
}
const stageOf = (r: ReturnType<typeof run>, name: string) => r.stages.find((s) => s.stage === name)!;

describe('name comparison', () => {
  it.each([
    ['Test Reddy', 'TEST REDDY', 'MATCH'],
    ['Reddy Test', 'Test Reddy', 'MATCH'],
    ['T. Reddy', 'Test Reddy', 'EXPECTED_VARIATION'],
    ['Test Reddy', 'Test Kumar Reddy', 'EXPECTED_VARIATION'],
    ['Ashwitha Reddy', 'Ashwita Reddy', 'EXPECTED_VARIATION'],
    ['TestReddy', 'Test Reddy', 'EXPECTED_VARIATION'],
    ['Test Reddy', 'Ravi Sharma', 'MISMATCH'],
    ['Test Reddy', 'Test Sharma', 'MISMATCH'],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(compareNames(a, b).result).toBe(expected);
  });
});

describe('date of birth and address comparison', () => {
  it('treats a year-only DOB as an expected variation and flags swapped day/month', () => {
    expect(compareDob({ full: '2000-01-05', year: '2000' }, { year: '2000' })?.result).toBe('EXPECTED_VARIATION');
    const swapped = compareDob({ full: '2000-05-01' }, { full: '2000-01-05' });
    expect(swapped?.result).toBe('MISMATCH');
    expect(swapped?.explanation).toMatch(/swapped/);
  });
  it('grades addresses instead of rejecting them', () => {
    expect(compareAddress('12 MG Road Hyderabad Telangana 500001', '12 M.G. Road, Hyderabad, Telangana - 500001').result).toBe('MATCH');
    expect(compareAddress('Flat 4 Lake View Hyderabad 500001', 'Plot 9 Hill Colony Hyderabad 500001').result).toBe('PARTIAL');
  });
});

describe('authenticity signals', () => {
  async function card(blur = 0): Promise<Buffer> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="630"><rect width="1000" height="630" fill="#fff"/>
      <text x="60" y="200" font-family="Arial" font-size="40">Test Person DOB 01/01/2000</text>
      <text x="60" y="400" font-family="Arial" font-size="54">2345 6789 0123</text></svg>`;
    let img = sharp(Buffer.from(svg));
    if (blur) img = img.blur(blur);
    return img.jpeg().toBuffer();
  }

  it('separates a sharp image from a blurred one', async () => {
    const sharpSig = await collectFileSignals('image/jpeg', await card());
    const blurSig = await collectFileSignals('image/jpeg', await card(6));
    expect(sharpSig.sharpness!).toBeGreaterThan(BLUR_THRESHOLD);
    expect(blurSig.sharpness!).toBeLessThan(BLUR_THRESHOLD);
    expect(authenticityFindings(blurSig, 0, 'Card').map((f) => f.code)).toContain('IMAGE_BLURRY');
  });

  it('flags editing tools and later edits in a PDF, and a locked PDF', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /Producer (Adobe Photoshop 25.0) >> endobj\ntrailer << >>\n%%EOF\n2 0 obj << >> endobj\n%%EOF\n', 'latin1');
    const s = await collectFileSignals('application/pdf', pdf);
    expect(s.editingSoftware).toBe('photoshop');
    expect(s.pdfIncrementalUpdates).toBe(1);
    const locked = await collectFileSignals('application/pdf', Buffer.from('%PDF-1.7\ntrailer << /Encrypt 5 0 R >>\n%%EOF', 'latin1'));
    expect(locked.locked).toBe(true);
  });
});

describe('pipeline stages', () => {
  it('runs every stage in the agreed order, each with one of four statuses and evidence', () => {
    const r = run({ documents: [doc(aadhaarText)] });
    expect(r.stages.map((s) => s.stage)).toEqual([...STAGE_ORDER]);
    for (const s of r.stages) {
      expect(['PASS', 'FAIL', 'NOT_RUN', 'UNKNOWN']).toContain(s.status);
      expect(Array.isArray(s.evidence)).toBe(true);
    }
    expect(r.providerVerified).toBe(false);
  });

  it('reports face, liveness and enrolled comparison as NOT_RUN without a live face', () => {
    const r = run({ documents: [doc(aadhaarText, { documentFace: docFace(embedding(1)) })] });
    expect(stageOf(r, 'DOCUMENT_PHOTO_VS_LIVE_FACE').status).toBe('NOT_RUN');
    expect(stageOf(r, 'PAD_LIVENESS').status).toBe('NOT_RUN');
    expect(stageOf(r, 'LIVE_FACE_VS_ENROLLED').status).toBe('NOT_RUN');
    expect(r.face.documentPhoto).toBe('USABLE_FACE');
  });

  it('does not claim a document photo comparison when no photo was provided', () => {
    const face = embedding(7);
    const r = run({ documents: [doc(aadhaarText)], live: { embedding: face }, padVerdict: { verdict: 'LIVE' } });
    expect(r.face.documentPhoto).toBe('NOT_PROVIDED');
    expect(stageOf(r, 'DOCUMENT_PHOTO_VS_LIVE_FACE').status).toBe('NOT_RUN');
    expect(r.documents[0]!.elements.PHOTOGRAPH?.status).toBe('NOT_CHECKED');
  });

  it('reports document elements: MRZ read, signature label, missing photo', () => {
    const passport = run({ claim: { userId: 'u', fullName: 'Anna Maria Eriksson' }, documents: [doc(ICAO_SPECIMEN)] });
    expect(passport.documents[0]!.elements.MRZ?.status).toBe('PRESENT');
    const pan = run({ documents: [doc(panText, { documentFace: null })] });
    expect(pan.documents[0]!.elements.SIGNATURE?.status).toBe('PRESENT');
    expect(pan.documents[0]!.elements.PHOTOGRAPH?.status).toBe('MISSING');
    expect(stageOf(pan, 'DOCUMENT_AUTHENTICITY_SIGNALS').findings.map((f) => f.code)).toContain('ELEMENT_MISSING');
  });

  it('flags a selected type that the content contradicts', () => {
    const r = run({ documents: [doc(panText, { declaredType: 'PASSPORT' })] });
    expect(r.documents[0]!.detectedType).toBe('PAN');
    expect(r.documents[0]!.typeMismatch).toBe(true);
    expect(stageOf(r, 'DOCUMENT_IDENTIFICATION').status).toBe('FAIL');
    expect(r.status).toBe('REVIEW_REQUIRED');
  });

  it('flags impossible printed dates', () => {
    const r = run({ documents: [doc(`${aadhaarText} Issue Date 31/02/2020`)] });
    expect(stageOf(r, 'DOCUMENT_VALIDATED').findings.some((f) => f.code === 'DATE_INVALID')).toBe(true);
  });
});

describe('decisions', () => {
  it('never passes identity on one document alone, even with a valid checksum', () => {
    const r = run({ documents: [doc(aadhaarText)] });
    expect(r.documentChecks).toBe('PASS');
    expect(r.documents[0]!.validation).toBe('PASS');
    expect(r.identityCorroborated).toBe(false);
    expect(r.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.reasons[0]).toMatch(/one document alone/);
  });

  it('passes when a second consistent document corroborates the identity', () => {
    const r = run({ documents: [doc(aadhaarText), doc(panText)] });
    expect(stageOf(r, 'CROSS_ID_CONSISTENCY').status).toBe('PASS');
    expect(r.identityCorroborated).toBe(true);
    expect(r.status).toBe('CHECKS_PASSED');
    expect(r.reasons.join(' ')).toMatch(/second, consistent identity document/);
    expect(r.reasons.join(' ')).toMatch(/not a government verification/);
  });

  it('passes one document when its photo matches a live face that passed liveness, with enrolled match reported separately', () => {
    const face = embedding(7);
    const r = run({
      documents: [doc(aadhaarText, { documentFace: docFace(near(face)) })],
      live: { embedding: face },
      enrolledTemplate: near(face, 0.005),
      padVerdict: { verdict: 'LIVE' },
    });
    expect(r.face).toMatchObject({ documentPhoto: 'USABLE_FACE', documentPhotoVsLive: 'PASS', liveVsEnrolled: 'PASS' });
    expect(r.pad.status).toBe('LIVE');
    expect(r.status).toBe('CHECKS_PASSED');
    expect(r.reasons[0]).toMatch(/live face that passed liveness/);
  });

  it('notes a low-severity indicator without blocking or hiding it', () => {
    const r = run({ documents: [doc(aadhaarText), doc(panText, { documentFace: null })] });
    expect(r.risks).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'SUSPICIOUS_PHOTO', severity: 'LOW' })]));
    expect(r.documentChecks).toBe('PASS');
    expect(r.status).toBe('CHECKS_PASSED');
    expect(r.reasons[0]).toMatch(/1 low-severity indicator noted/);
    expect(r.reasons[0]).not.toMatch(/no risk indicators/);
  });

  it('keeps liveness and face similarity separate', () => {
    const r = run({ documents: [doc(aadhaarText, { documentFace: docFace(embedding(42)) })], live: { embedding: embedding(5) }, padVerdict: { verdict: 'LIVE' } });
    expect(stageOf(r, 'DOCUMENT_PHOTO_VS_LIVE_FACE').status).toBe('FAIL');
    expect(stageOf(r, 'PAD_LIVENESS').status).toBe('PASS');
    expect(r.status).toBe('REVIEW_REQUIRED');
  });

  it('returns LIVE / SPOOF / UNKNOWN from liveness with the right outcome', () => {
    const live = { embedding: embedding(3) };
    const spoof = run({ documents: [doc(aadhaarText)], live, padVerdict: { verdict: 'SPOOF', reasons: ['screen_moire'] } });
    expect(spoof.pad.status).toBe('SPOOF');
    expect(spoof.status).toBe('REJECTED');
    const unknown = run({ documents: [doc(aadhaarText)], live, padVerdict: { verdict: 'UNKNOWN' } });
    expect(unknown.pad.status).toBe('UNKNOWN');
    expect(stageOf(unknown, 'PAD_LIVENESS').status).toBe('UNKNOWN');
    expect(unknown.status).toBe('REVIEW_REQUIRED');
  });

  it('rejects an enrolled-face mismatch and a document on another account', () => {
    const imp = run({ documents: [doc(aadhaarText)], live: { embedding: embedding(3) }, enrolledTemplate: embedding(99), padVerdict: { verdict: 'LIVE' } });
    expect(stageOf(imp, 'LIVE_FACE_VS_ENROLLED').status).toBe('FAIL');
    expect(imp.status).toBe('REJECTED');
    const dup = run({ documents: [doc(aadhaarText, { numberFingerprint: 'fp-1' })], fingerprintsOnOtherAccounts: new Set(['fp-1']) });
    expect(dup.status).toBe('REJECTED');
    expect(dup.risks.map((x) => x.category)).toContain('DUPLICATE_DOCUMENT');
  });

  it('asks for review, not rejection, when names disagree across documents', () => {
    const r = run({ documents: [doc(aadhaarText), doc(panText.replace('TEST REDDY', 'RAVI SHARMA'))] });
    expect(r.crossDocument.findings.map((f) => f.code)).toContain('NAME_MISMATCH');
    expect(r.status).toBe('REVIEW_REQUIRED');
  });

  it('sends an unsupported government ID to review instead of pretending to know it', () => {
    const r = run({ documents: [doc('Republic of Freedonia National Identity Card Name: Test Reddy Date of Birth 01/01/2000 ID No AB123456')] });
    expect(r.documents[0]!.detectedType).toBe('GOVERNMENT_ID');
    expect(stageOf(r, 'DOCUMENT_IDENTIFICATION').findings.map((f) => f.code)).toContain('TYPE_REVIEW_ONLY');
    expect(r.status).toBe('REVIEW_REQUIRED');
  });

  it('reports not enough information for unreadable or unsupported files', () => {
    expect(run({ documents: [doc('')] }).status).toBe('INSUFFICIENT_EVIDENCE');
    expect(run({ documents: [doc('Invoice 1234 amount due')] }).status).toBe('INSUFFICIENT_EVIDENCE');
    const locked = run({ documents: [doc('', { mimeType: 'application/pdf', fileSignals: { locked: true } })] });
    expect(stageOf(locked, 'DOCUMENT_IDENTIFICATION').findings.map((f) => f.code)).toContain('FILE_LOCKED');
  });

  it('flags an expired passport for review', () => {
    const r = run({ claim: { userId: 'u', fullName: 'Anna Maria Eriksson' }, documents: [doc(ICAO_SPECIMEN)] });
    expect(r.documents[0]!.expired).toBe(true);
    expect(r.status).toBe('REVIEW_REQUIRED');
  });

  it('explains every decision with the stages and codes that produced it', () => {
    const review = run({ documents: [doc(panText, { declaredType: 'PASSPORT' })] });
    expect(review.decisionBasis.length).toBeGreaterThan(0);
    expect(review.decisionBasis.find((b) => b.stage === 'DOCUMENT_IDENTIFICATION')?.codes).toContain('TYPE_MISMATCH');
    const passed = run({ documents: [doc(aadhaarText), doc(panText)] });
    expect(passed.decisionBasis.map((b) => b.stage)).toEqual(expect.arrayContaining(['DOCUMENT_VALIDATED', 'CROSS_ID_CONSISTENCY']));
  });

  it('keeps raw document numbers and names out of the audit record', () => {
    const r = run({ documents: [doc(aadhaarText, { numberFingerprint: 'hmac-abc' }), doc(panText)] });
    const audit = JSON.stringify(r.audit);
    expect(audit).not.toContain(AADHAAR);
    expect(audit).not.toContain('ABCPR1234F');
    expect(audit).not.toMatch(/reddy/i);
    expect(r.audit.numberFingerprints).toEqual(['hmac-abc', null]);
    expect(r.audit.decisionCodes.length).toBeGreaterThan(0);
    expect(Object.keys(r.audit.stageStatuses)).toEqual([...STAGE_ORDER]);
  });
});
