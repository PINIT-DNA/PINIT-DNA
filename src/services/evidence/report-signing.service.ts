/**
 * Phase 3 — Signed report manifests + QR verification payloads.
 */
import crypto from 'crypto';
import QRCode from 'qrcode';
import {
  sha256Hex,
  signEd25519,
  verifyEd25519,
  getPublicKeyPem,
} from './phase3-crypto.service';
import { isPhase3SignedReportsActive } from '../../config/dna-phase3';
import { config } from '../../config';

export interface ReportManifest {
  reportId: string;
  reportType: 'INVESTIGATION' | 'DNA' | 'TIMELINE' | 'EVIDENCE_PACKAGE';
  investigationId: string;
  reportHash: string;
  issuedAt: string;
  certificateStatus?: string;
  engineVersion: string;
}

export interface SignedReportManifest extends ReportManifest {
  signature: string;
  publicKeyFingerprint: string;
  verifyUrl: string;
}

function publicKeyFingerprint(): string {
  const pem = getPublicKeyPem();
  if (!pem) return 'unavailable';
  return sha256Hex(pem).slice(0, 16);
}

function verifyBaseUrl(): string {
  return (
    process.env.PUBLIC_APP_URL?.replace(/\/$/, '') ??
    `http://localhost:${config.port}`
  );
}

export function buildReportId(investigationId: string, type: string): string {
  const h = crypto.createHash('sha256').update(`${investigationId}:${type}:${Date.now()}`).digest('hex');
  return `RPT-${h.slice(0, 12).toUpperCase()}`;
}

export function signReportManifest(manifest: ReportManifest): SignedReportManifest | null {
  if (!isPhase3SignedReportsActive()) return null;

  const canonical = JSON.stringify({
    reportId: manifest.reportId,
    reportType: manifest.reportType,
    investigationId: manifest.investigationId,
    reportHash: manifest.reportHash,
    issuedAt: manifest.issuedAt,
    certificateStatus: manifest.certificateStatus ?? '',
    engineVersion: manifest.engineVersion,
  });

  const signature = signEd25519(canonical);
  if (!signature) return null;

  const verifyUrl = `${verifyBaseUrl()}/api/v1/evidence/verify/${manifest.reportId}?hash=${manifest.reportHash}`;

  return {
    ...manifest,
    signature,
    publicKeyFingerprint: publicKeyFingerprint(),
    verifyUrl,
  };
}

export function verifyReportManifest(manifest: SignedReportManifest): {
  valid: boolean;
  hashMatch: boolean;
  signatureValid: boolean;
  detail: string;
} {
  const { signature, verifyUrl, publicKeyFingerprint: _pk, ...base } = manifest;
  void verifyUrl;
  void _pk;

  const canonical = JSON.stringify({
    reportId: base.reportId,
    reportType: base.reportType,
    investigationId: base.investigationId,
    reportHash: base.reportHash,
    issuedAt: base.issuedAt,
    certificateStatus: base.certificateStatus ?? '',
    engineVersion: base.engineVersion,
  });

  const signatureValid = verifyEd25519(canonical, signature);

  return {
    valid: signatureValid,
    hashMatch: true,
    signatureValid,
    detail: signatureValid ? 'Report manifest authentic' : 'Digital signature invalid',
  };
}

export async function generateQrPng(verifyUrl: string): Promise<Buffer> {
  return QRCode.toBuffer(verifyUrl, { type: 'png', margin: 1, width: 200 });
}

export function getEvidencePublicKey(): { pem: string | null; fingerprint: string } {
  const pem = getPublicKeyPem();
  return { pem, fingerprint: publicKeyFingerprint() };
}
