/**
 * Generates a real Evidence Report PDF and checks filename + forensic payload.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { jsPDF } from 'jspdf';
import { buildEnterpriseInvestigationViewModel } from '../client/src/lib/enterprise-investigation-report-model';
import { forensicReportFilename, investigatedAssetName } from '../client/src/lib/forensic-report-filename';
import { drawEvidenceVerification, drawInvestigationEvidencePdf } from '../client/src/services/investigation-evidence-pdf';

const INVESTIGATION_ID = '7f2a9c1e-44b8-4d21-9a6f-b1c0d2e3f456';
const VAULT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const DNA_ID = 'd9e8f7a6-b5c4-3210-9876-543210fedcba';
const CERT_ID = 'CERT-DNA-A1B2C3D4-BEACH-0001';
const PINIT_ID = 'PINIT-ASHWITHA-004281';
const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const report = {
  investigationId: INVESTIGATION_ID,
  investigatedAt: '2026-09-11T06:30:00.000Z',
  success: true,
  pipeline: [
    { id: 'retrieve', label: 'Vault retrieval', status: 'complete', detail: 'Selected original' },
    { id: 'dna_compare', label: '15-layer DNA comparison', status: 'complete', detail: '97%' },
  ],
  summary: {
    reportState: 'VERIFIED' as const,
    acceptanceVerdict: 'VERIFIED_ORIGINAL',
    acceptanceConfidence: 97,
    acceptancePolicyVersion: 'acceptance-policy-v1.2',
    decisionReason: 'Cryptographic and perceptual layers retained ownership of The beach.jpg',
    ownershipConfidence: 98,
    dnaMatchPercent: 97,
    certificateStatus: 'ISSUED',
    identityStatus: 'FOUND',
    tamperSeverity: 'NONE',
    riskLevel: 'LOW',
    retrievalConfidence: 96,
  },
  owner: {
    originalFilename: 'The beach.jpg',
    ownerName: 'Ashwithareddy',
    ownerPinitId: PINIT_ID,
    vaultId: VAULT_ID,
    dnaRecordId: DNA_ID,
    certificateId: CERT_ID,
  },
  layerAnalysis: [
    { layer: 1, name: 'Cryptographic SHA-256', matchPercent: 100, status: 'verified', explanation: 'Exact hash match' },
    { layer: 3, name: 'Perceptual hash', matchPercent: 94, status: 'verified', explanation: 'Visual fingerprint aligned' },
    { layer: 5, name: 'Metadata', matchPercent: 88, status: 'verified', explanation: 'EXIF family consistent' },
  ],
  tamperAnalysis: {
    primaryVector: 'NONE',
    overallTamperScore: 4,
    vectors: [{ label: 'Crop', detected: false }],
    description: 'No material tampering relative to the sealed original.',
  },
  identityProof: {
    digitalSignatureValid: true,
    identityVerification: 'VERIFIED',
    vaultId: VAULT_ID,
    dnaRecordId: DNA_ID,
    certificateId: CERT_ID,
    ownerPinitId: PINIT_ID,
    watermark: {},
  },
  dnaComparison: {
    classification: 'ORIGINAL',
    overallConfidenceScore: 97,
    fileA: { filename: 'The beach.jpg', mimeType: 'image/jpeg', sizeBytes: 1_204_112 },
    fileB: { filename: 'The beach.jpg', mimeType: 'image/jpeg', sizeBytes: 1_204_112 },
  },
  currentFileHash: SHA,
  candidateRanking: [
    {
      rank: 1,
      vaultId: VAULT_ID,
      dnaRecordId: DNA_ID,
      compositeScore: 97,
      method: 'vector',
      signals: ['sha256', 'phash'],
      selected: true,
    },
  ],
  leakIntelligence: { hasPublicLeak: false, message: 'No public leak recorded for this asset.' },
  timeline: [{ stage: 'Stored', timestamp: '2026-08-26T00:00:00.000Z', detail: 'Vault sealed' }],
  accessIntelligence: [],
  recipientAttribution: {},
};

function extractPdfText(buf: Buffer): string {
  const chunks: string[] = [];
  const re = /\((?:\\.|[^\\)]){2,}\)(?=\s*(?:Tj|TJ))/g;
  const raw = buf.toString('latin1');
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    chunks.push(
      m[0]
        .slice(1, -1)
        .replace(/\\n/g, ' ')
        .replace(/\\([()\\])/g, '$1'),
    );
  }
  return chunks.join('\n');
}

describe('forensic evidence report PDF generation', () => {
  test('writes <Asset Name> - Evidence Report.pdf with verdict and full IDs', () => {
    const filename = forensicReportFilename(report);
    const assetName = investigatedAssetName(report);
    const vm = buildEnterpriseInvestigationViewModel(report);

    expect(filename).toBe('The beach - Evidence Report.pdf');
    expect(filename).not.toContain(INVESTIGATION_ID);
    expect(assetName).toBe('The beach');
    expect(vm.summary.finalVerdict).toBe('VERIFIED ORIGINAL');

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const slot = drawInvestigationEvidencePdf(doc, {
      vm,
      assetName,
      leakMessage: report.leakIntelligence.message,
      currentFileHash: SHA,
    });
    drawEvidenceVerification(doc, slot, null);

    const outDir = join(process.cwd(), 'tmp');
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, filename);
    const buf = Buffer.from(doc.output('arraybuffer'));
    writeFileSync(outPath, buf);

    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);

    const text = extractPdfText(readFileSync(outPath));
    expect(text).toContain('The beach');
    expect(text).toContain('VERIFIED ORIGINAL');
    expect(text).toContain(INVESTIGATION_ID);
    expect(text).toContain(VAULT_ID);
    expect(text).toContain(DNA_ID);
    expect(text).toContain(CERT_ID);
    expect(text).toContain(PINIT_ID);
    expect(text).toContain(SHA);
    expect(text).toContain('NOT ENTERED');
    expect(text).toContain('CERTIFICATION AND LEGAL NOTICE');
    expect(text).toContain('AUTHENTICATION');
  });
});
