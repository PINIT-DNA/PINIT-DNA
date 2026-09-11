import { forensicReportFilename, forensicExportBaseName } from '../client/src/lib/forensic-report-filename';

const INV = '7f2a9c1e-44b8-4d21-9a6f-b1c0d2e3f456';

function beachReport(overrides: Record<string, unknown> = {}) {
  return {
    investigationId: INV,
    investigatedAt: '2026-09-11T06:30:00.000Z',
    success: true,
    pipeline: [],
    summary: {
      reportState: 'VERIFIED',
      acceptanceVerdict: 'VERIFIED_ORIGINAL',
      ownershipConfidence: 98,
      dnaMatchPercent: 97,
      certificateStatus: 'ISSUED',
      identityStatus: 'FOUND',
      tamperSeverity: 'NONE',
      riskLevel: 'LOW',
    },
    owner: {
      originalFilename: 'The beach.jpg',
      vaultId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      dnaRecordId: 'd9e8f7a6-b5c4-3210-9876-543210fedcba',
    },
    layerAnalysis: [],
    tamperAnalysis: { primaryVector: 'NONE', overallTamperScore: 0, vectors: [] },
    identityProof: { digitalSignatureValid: true, identityVerification: 'VERIFIED', watermark: { status: 'DETECTED' } },
    timeline: [],
    ...overrides,
  };
}

describe('forensic evidence report filename', () => {
  test('uses the asset name, not the investigation UUID', () => {
    const name = forensicReportFilename(beachReport());
    expect(name).toBe('The beach - Evidence Report.pdf');
    expect(name).not.toContain(INV);
    expect(forensicExportBaseName(beachReport())).toBe('The beach');
  });

  test('strips filesystem-illegal characters and never emits a UUID stem', () => {
    const name = forensicReportFilename(beachReport({
      owner: { originalFilename: 'The beach: final*.jpg', vaultId: 'v1' },
    }));
    expect(name).toBe('The beach final - Evidence Report.pdf');
    expect(name.startsWith(INV)).toBe(false);
  });
});
