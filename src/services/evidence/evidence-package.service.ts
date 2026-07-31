/**
 * Phase 3 — Evidence package ZIP (server-side).
 */
import JSZip from 'jszip';
import {
  signReportManifest,
  buildReportId,
  generateQrPng,
  type SignedReportManifest,
} from './report-signing.service';
import { sha256Hex } from './phase3-crypto.service';
import { isPhase3EvidencePackageActive } from '../../config/dna-phase3';

export interface EvidencePackageInput {
  investigationId: string;
  certificateStatus: string;
  investigationPdf: Buffer;
  dnaPdf: Buffer;
  timelinePdf: Buffer;
  identity: object;
  hashes: object;
  certificate: object;
  accessLogs: object;
  fullReport: object;
}

export interface EvidencePackageResult {
  zipBuffer: Buffer;
  manifest: SignedReportManifest;
  qrPng: Buffer;
}

export async function buildEvidencePackage(input: EvidencePackageInput): Promise<EvidencePackageResult | null> {
  if (!isPhase3EvidencePackageActive()) return null;

  const zip = new JSZip();
  zip.file('InvestigationReport.pdf', input.investigationPdf);
  zip.file('DNAReport.pdf', input.dnaPdf);
  zip.file('TimelineReport.pdf', input.timelinePdf);
  zip.file('Identity.json', JSON.stringify(input.identity, null, 2));
  zip.file('Hashes.json', JSON.stringify(input.hashes, null, 2));
  zip.file('Certificate.json', JSON.stringify(input.certificate, null, 2));
  zip.file('AccessLogs.json', JSON.stringify(input.accessLogs, null, 2));
  zip.file('Evidence.json', JSON.stringify(input.fullReport, null, 2));

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const reportHash = sha256Hex(zipBuffer);
  const reportId = buildReportId(input.investigationId, 'EVIDENCE_PACKAGE');

  const manifest = signReportManifest({
    reportId,
    reportType: 'EVIDENCE_PACKAGE',
    investigationId: input.investigationId,
    reportHash,
    issuedAt: new Date().toISOString(),
    certificateStatus: input.certificateStatus,
    engineVersion: '2.3-phase3',
  });

  if (!manifest) return null;

  zip.file('EvidenceManifest.json', JSON.stringify(manifest, null, 2));
  const sig = Buffer.from(manifest.signature, 'base64url');
  zip.file('DigitalSignature.sig', sig);

  const qrPng = await generateQrPng(manifest.verifyUrl);
  zip.file('QR.png', qrPng);

  const finalZip = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  return { zipBuffer: finalZip, manifest, qrPng };
}
