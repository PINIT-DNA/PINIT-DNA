/**
 * Service layer with an in-memory Prisma stand-in: duplicate detection across
 * accounts, encrypted run records, owner masking, and request parsing.
 */
const store = {
  users: new Map<string, { fullName: string }>([
    ['owner-1', { fullName: 'Test Reddy' }],
    ['owner-2', { fullName: 'Other Person' }],
  ]),
  runs: [] as Array<Record<string, unknown>>,
  fingerprints: [] as Array<{ fingerprint: string; userId: string; documentType: string }>,
};

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async ({ where, select }: { where: { id: string }; select: Record<string, unknown> }) => {
        const u = store.users.get(where.id);
        if (!u) return null;
        if (select.biometricIdentity) return { biometricIdentity: null };
        return { fullName: u.fullName };
      }),
    },
    identityVerificationRun: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `run-${store.runs.length + 1}`, createdAt: new Date(), ...data };
        store.runs.push(row);
        return { id: row.id };
      }),
      findFirst: jest.fn(async ({ where }: { where: { userId: string; trigger?: string } }) => {
        const rows = store.runs.filter((r) => r.userId === where.userId && (!where.trigger || r.trigger === where.trigger));
        return rows[rows.length - 1] ?? null;
      }),
    },
    identityDocumentFingerprint: {
      findMany: jest.fn(async ({ where }: { where: { fingerprint: { in: string[] }; NOT: { userId: string } } }) =>
        store.fingerprints.filter((f) => where.fingerprint.in.includes(f.fingerprint) && f.userId !== where.NOT.userId)),
      upsert: jest.fn(async ({ create }: { create: { fingerprint: string; userId: string; documentType: string } }) => {
        if (!store.fingerprints.some((f) => f.fingerprint === create.fingerprint && f.userId === create.userId)) {
          store.fingerprints.push(create);
        }
        return create;
      }),
    },
  },
}));

import sharp from 'sharp';
import {
  identityVerificationService, ownerView,
} from '../../src/services/identity-verification/identity-verification.service';
import { parseAnalyzeBody, parseDeviceFace } from '../../src/api/controllers/identity-verification.controller';
import { verhoeffCheckDigit } from '../../src/services/identity-verification/checksums';

const prefix = '34567890123';
const AADHAAR = prefix + verhoeffCheckDigit(prefix);
const text = `Government of India Test Reddy DOB: 01/01/2000 FEMALE ${AADHAAR.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}`;

async function cardJpeg(): Promise<Buffer> {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="630"><rect width="1000" height="630" fill="#fff"/><text x="60" y="300" font-family="Arial" font-size="48">Sample card</text></svg>';
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

describe('identity verification service', () => {
  it('records an encrypted run and lets only the owner read it back', async () => {
    const bytes = await cardJpeg();
    const { result, runId } = await identityVerificationService.verify({
      userId: 'owner-1', trigger: 'ANALYZE',
      documents: [{ bytes, mimeType: 'image/jpeg', declaredType: 'AADHAAR', extractedText: text }],
    });
    expect(runId).toBe('run-1');
    expect(result.documents[0]!.detectedType).toBe('AADHAAR');
    const stored = store.runs[0]!;
    // Clear columns hold only codes; the cipher does not contain the number in plain text.
    expect(Buffer.from(stored.resultCipher as Buffer).toString('latin1')).not.toContain(AADHAAR);
    expect(JSON.stringify({ ...stored, resultCipher: undefined })).not.toContain(AADHAAR);
    const latest = await identityVerificationService.latestForOwner('owner-1');
    expect(latest?.result.documents[0]!.fields.documentNumber?.value).toBe(AADHAAR);
    expect(await identityVerificationService.latestForOwner('owner-2')).toBeNull();
  });

  it('flags the same document on a second account and rejects it', async () => {
    const bytes = await cardJpeg();
    const first = await identityVerificationService.verify({
      userId: 'owner-1', trigger: 'PROOF_SAVED',
      documents: [{ bytes, mimeType: 'image/jpeg', declaredType: 'AADHAAR', extractedText: text }],
    });
    await identityVerificationService.registerFingerprints('owner-1', first.result);
    expect(store.fingerprints).toHaveLength(1);
    expect(store.fingerprints[0]!.fingerprint).not.toContain(AADHAAR);

    const second = await identityVerificationService.verify({
      userId: 'owner-2', trigger: 'PROOF_SAVED',
      documents: [{ bytes, mimeType: 'image/jpeg', declaredType: 'AADHAAR', extractedText: text.replace('Test Reddy', 'Other Person') }],
    });
    expect(second.result.status).toBe('REJECTED');
    expect(second.result.risks.map((r) => r.category)).toContain('DUPLICATE_DOCUMENT');

    // The owner re-checking their own document is not a duplicate.
    const again = await identityVerificationService.verify({
      userId: 'owner-1', trigger: 'ANALYZE',
      documents: [{ bytes, mimeType: 'image/jpeg', declaredType: 'AADHAAR', extractedText: text }],
    });
    expect(again.result.risks.map((r) => r.category)).not.toContain('DUPLICATE_DOCUMENT');
  });

  it('masks document numbers and drops the audit block in the owner view', async () => {
    const latest = await identityVerificationService.latestForOwner('owner-1');
    const view = ownerView(latest!.result);
    expect(view.documents[0]!.fields.documentNumber?.value).toBe(`${'•'.repeat(8)}${AADHAAR.slice(-4)}`);
    expect(JSON.stringify(view)).not.toContain(AADHAAR);
    expect((view as Record<string, unknown>).audit).toBeUndefined();
    // The owner sees the document checks and the identity decision separately, with its basis.
    expect(view.documentChecks).toBe('PASS');
    expect(view.identityCorroborated).toBe(false);
    expect(Array.isArray(view.decisionBasis)).toBe(true);
  });
});

describe('analyze request parsing', () => {
  const emb = Array.from({ length: 128 }, (_, i) => i / 128);
  it('accepts per-file types, device faces and a live capture', () => {
    const r = parseAnalyzeBody({
      documentTypes: JSON.stringify(['AADHAAR', 'BOGUS']),
      documentFaces: JSON.stringify([{ embedding: emb, detectionScore: 0.9 }, null]),
      live: JSON.stringify({ embedding: emb, padEvidence: { frames: 3 } }),
    }, 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.types).toEqual(['AADHAAR', null]);
      expect(r.faces[0]?.detectionScore).toBe(0.9);
      expect(r.faces[1]).toBeNull();
      expect(r.live?.embedding).toHaveLength(128);
    }
  });
  it('rejects malformed JSON and bad embeddings', () => {
    expect(parseAnalyzeBody({ documentTypes: '{oops' }, 1).ok).toBe(false);
    expect(parseAnalyzeBody({ live: JSON.stringify({ embedding: [1, 2, 3] }) }, 1).ok).toBe(false);
  });
});

describe('second ID proof against the saved proof', () => {
  const p3 = '45678901234';
  const own = p3 + verhoeffCheckDigit(p3);
  const text3 = text.replace(/\d{4} \d{4} \d{4}/, own.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3'));
  const pan = "INCOME TAX DEPARTMENT GOVT. OF INDIA Permanent Account Number Card ABCPR1234F Name / TEST REDDY Father's Name / SAMPLE REDDY Date of Birth 01/01/2000";

  it('a single saved proof is not enough; a consistent second proof corroborates it without re-reading the file', async () => {
    store.users.set('owner-3', { fullName: 'Test Reddy' });
    const bytes = await cardJpeg();
    const saved = await identityVerificationService.verify({
      userId: 'owner-3', trigger: 'PROOF_SAVED',
      documents: [{ bytes, mimeType: 'image/jpeg', declaredType: 'AADHAAR', extractedText: text3 }],
    });
    expect(saved.result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(saved.result.documentChecks).toBe('PASS');

    const second = await identityVerificationService.verify({
      userId: 'owner-3', trigger: 'ANALYZE', includeSavedProof: true,
      documents: [{ bytes, mimeType: 'image/jpeg', declaredType: 'PAN', extractedText: pan }],
    });
    expect(second.result.documents.map((d) => [d.detectedType, d.origin])).toEqual([['PAN', 'SUBMITTED'], ['AADHAAR', 'SAVED_PROOF']]);
    expect(second.result.identityCorroborated).toBe(true);
    expect(second.result.status).toBe('CHECKS_PASSED');
  });

  it('flags a second proof that belongs to someone else', async () => {
    const bytes = await cardJpeg();
    const other = await identityVerificationService.verify({
      userId: 'owner-3', trigger: 'ANALYZE', includeSavedProof: true,
      documents: [{ bytes, mimeType: 'image/jpeg', declaredType: 'PAN', extractedText: pan.replace('TEST REDDY', 'RAVI SHARMA') }],
    });
    expect(other.result.status).toBe('REVIEW_REQUIRED');
    expect(other.result.crossDocument.findings.map((f) => f.code)).toContain('NAME_MISMATCH');
  });
});

describe('device face parsing', () => {
  const emb = Array.from({ length: 128 }, (_, i) => i / 256);
  it('separates examined-no-face from not-examined', () => {
    expect(parseDeviceFace('null')).toBeNull();
    expect(parseDeviceFace(undefined)).toBeUndefined();
    expect(parseDeviceFace(JSON.stringify({ embedding: [1, 2] }))).toBeUndefined();
    expect(parseDeviceFace(JSON.stringify({ embedding: emb, detectionScore: 0.8 }))?.detectionScore).toBe(0.8);
  });
});

describe('front and back sides', () => {
  async function pdf(text: string): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFDocument, StandardFonts } = require('pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(text, { x: 40, y: 700, size: 11, font });
    return Buffer.from(await doc.save());
  }

  it('reads the back side and joins its text to the front, so back-only fields are found', async () => {
    const { prepareDocument } = await import('../../src/services/identity-verification/identity-verification.service');
    const { aadhaarAdapter } = await import('../../src/services/identity-verification/adapters/aadhaar');
    const front = await pdf(text);
    const back = await pdf('Address: 12 MG Road, Hyderabad, Telangana 500001');
    const prepared = await prepareDocument({ bytes: front, mimeType: 'application/pdf', declaredType: 'AADHAAR', backBytes: back, backMimeType: 'application/pdf' });
    expect(prepared.extractedText).toContain('Government of India');
    expect(prepared.extractedText).toContain('500001');
    const fields = aadhaarAdapter.extract(prepared.extractedText, { now: new Date(), documentIndex: 0 });
    expect(fields.address?.value).toMatch(/Hyderabad/);
    expect(fields.documentNumber?.value).toBe(AADHAAR);
  });
});
