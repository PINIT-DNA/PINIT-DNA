/**
 * PINIT-DNA — Certificate Service (Phase 2 Hardening)
 *
 * Handles certificate lifecycle:
 *   - Issue: persist to DB + HMAC-SHA256 sign
 *   - Verify: check signature + status (ACTIVE/REVOKED/EXPIRED)
 *   - Revoke: mark as REVOKED with reason + timestamp
 *
 * Does NOT change certificate UI or PDF generation logic.
 */

import crypto  from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CertificateStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface IssuedCertificate {
  certificateId:   string;
  dnaRecordId:     string;
  vaultId:         string;
  status:          CertificateStatus;
  signature:       string;
  issuedAt:        string;
  expiresAt:       string | null;
  revokedAt:       string | null;
  revocationReason:string | null;
  issuedByUserId:  string | null;
}

export interface VerificationOutcome {
  valid:           boolean;
  status:          CertificateStatus | 'NOT_FOUND';
  signatureValid:  boolean;
  certificateId:   string;
  detail:          string;
  certificate:     IssuedCertificate | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class CertificateService {
  private readonly signingSecret: string;

  constructor() {
    // Signing secret derived from master secret — separate namespace
    this.signingSecret = `CERT_SIGN::${config.vault.masterSecret}`;
  }

  // ─── Issue ──────────────────────────────────────────────────────────────────

  /**
   * Issue a certificate for a vaulted DNA record.
   * Idempotent — returns existing certificate if already issued.
   */
  async issue(params: {
    dnaRecordId:    string;
    vaultId:        string;
    issuedByUserId? :string;
    ownerUserId?:   string;
    expiresInDays?  :number;   // optional expiry — null = never expires
  }): Promise<IssuedCertificate> {
    const dna = await prisma.dnaRecord.findUnique({
      where: { id: params.dnaRecordId },
      select: { ownerUserId: true },
    });
    if (!dna) throw new Error(`DNA record not found: ${params.dnaRecordId}`);
    if (params.ownerUserId) {
      const { assertRecordOwner } = await import('../../lib/tenant-scope');
      assertRecordOwner(dna.ownerUserId, params.ownerUserId, 'DNA record');
    }
    const ownerUserId = dna.ownerUserId ?? params.ownerUserId ?? params.issuedByUserId ?? null;

    // Check existing
    const existing = await prisma.certificate.findFirst({
      where: {
        dnaRecordId: params.dnaRecordId,
        vaultId:     params.vaultId,
        status:      'ACTIVE',
      },
    });
    if (existing) return this.toDto(existing);

    const certificateId = `CERT-DNA-${uuidv4().toUpperCase()}`;
    const issuedAt      = new Date();
    const expiresAt     = params.expiresInDays
      ? new Date(issuedAt.getTime() + params.expiresInDays * 86400000)
      : null;

    // Build canonical payload for signing
    const payload   = this.buildPayload(certificateId, params.dnaRecordId, params.vaultId, issuedAt.toISOString());
    const signature = this.sign(payload);

    const cert = await prisma.certificate.create({
      data: {
        certificateId,
        dnaRecordId:   params.dnaRecordId,
        vaultId:       params.vaultId,
        status:        'ACTIVE',
        signature,
        issuedAt,
        expiresAt,
        issuedByUserId: params.issuedByUserId ?? null,
        ownerUserId,
      },
    });

    logger.info('Certificate issued', { certificateId, dnaRecordId: params.dnaRecordId });
    return this.toDto(cert);
  }

  // ─── Verify ─────────────────────────────────────────────────────────────────

  async verify(certificateId: string): Promise<VerificationOutcome> {
    const cert = await prisma.certificate.findUnique({ where: { certificateId } });

    if (!cert) {
      return {
        valid: false, status: 'NOT_FOUND', signatureValid: false,
        certificateId, detail: 'Certificate not found in registry', certificate: null,
      };
    }

    // Check expiry
    if (cert.expiresAt && new Date() > cert.expiresAt) {
      await prisma.certificate.update({ where: { certificateId }, data: { status: 'EXPIRED' } });
      return {
        valid: false, status: 'EXPIRED', signatureValid: false,
        certificateId, detail: `Certificate expired at ${cert.expiresAt.toISOString()}`,
        certificate: this.toDto({ ...cert, status: 'EXPIRED' }),
      };
    }

    // Check revocation
    if (cert.status === 'REVOKED') {
      return {
        valid: false, status: 'REVOKED', signatureValid: false,
        certificateId,
        detail: `Certificate revoked at ${cert.revokedAt?.toISOString()} — Reason: ${cert.revocationReason ?? 'unspecified'}`,
        certificate: this.toDto(cert),
      };
    }

    // Verify HMAC signature
    const payload       = this.buildPayload(cert.certificateId, cert.dnaRecordId, cert.vaultId, cert.issuedAt.toISOString());
    const expectedSig   = this.sign(payload);
    const signatureValid = crypto.timingSafeEqual(
      Buffer.from(cert.signature, 'hex'),
      Buffer.from(expectedSig, 'hex')
    );

    if (!signatureValid) {
      return {
        valid: false, status: 'ACTIVE', signatureValid: false,
        certificateId, detail: 'Certificate signature is INVALID — possible forgery detected',
        certificate: this.toDto(cert),
      };
    }

    return {
      valid: true, status: 'ACTIVE', signatureValid: true,
      certificateId, detail: 'Certificate is VALID — signature verified, status ACTIVE',
      certificate: this.toDto(cert),
    };
  }

  /**
   * Resolve the best active certificate for a vault asset.
   * Tries hint ID → DNA+vault → DNA only → vault only (tenant-scoped when ownerUserId given).
   */
  async findActiveForAsset(params: {
    dnaRecordId?: string;
    vaultId?: string;
    ownerUserId?: string;
    hintCertificateId?: string | null;
  }): Promise<IssuedCertificate | null> {
    const ownerFilter = params.ownerUserId ? { ownerUserId: params.ownerUserId } : {};

    if (params.hintCertificateId) {
      const hinted = await prisma.certificate.findUnique({
        where: { certificateId: params.hintCertificateId },
      });
      if (hinted?.status === 'ACTIVE') {
        if (!params.ownerUserId || hinted.ownerUserId === params.ownerUserId) {
          return this.toDto(hinted);
        }
      }
    }

    if (params.dnaRecordId && params.vaultId) {
      const exact = await prisma.certificate.findFirst({
        where: {
          dnaRecordId: params.dnaRecordId,
          vaultId: params.vaultId,
          status: 'ACTIVE',
          ...ownerFilter,
        },
        orderBy: { issuedAt: 'desc' },
      });
      if (exact) return this.toDto(exact);
    }

    if (params.dnaRecordId) {
      const byDna = await prisma.certificate.findFirst({
        where: { dnaRecordId: params.dnaRecordId, status: 'ACTIVE', ...ownerFilter },
        orderBy: { issuedAt: 'desc' },
      });
      if (byDna) return this.toDto(byDna);
    }

    if (params.vaultId) {
      const byVault = await prisma.certificate.findFirst({
        where: { vaultId: params.vaultId, status: 'ACTIVE', ...ownerFilter },
        orderBy: { issuedAt: 'desc' },
      });
      if (byVault) return this.toDto(byVault);
    }

    return null;
  }

  // ─── Revoke ──────────────────────────────────────────────────────────────────

  async revoke(certificateId: string, reason: string, revokedByUserId?: string): Promise<IssuedCertificate> {
    const cert = await prisma.certificate.findUnique({ where: { certificateId } });
    if (!cert) throw new Error(`Certificate not found: ${certificateId}`);
    if (cert.status === 'REVOKED') throw new Error('Certificate is already revoked');
    if (revokedByUserId) {
      const { assertCertificateOwnerByCertId } = await import('../../lib/tenant-scope');
      await assertCertificateOwnerByCertId(certificateId, revokedByUserId);
    }

    const updated = await prisma.certificate.update({
      where: { certificateId },
      data:  { status: 'REVOKED', revokedAt: new Date(), revocationReason: reason },
    });

    logger.info('Certificate revoked', { certificateId, reason, revokedByUserId });
    return this.toDto(updated);
  }

  // ─── List ────────────────────────────────────────────────────────────────────

  async listByDnaRecord(dnaRecordId: string, userId: string): Promise<IssuedCertificate[]> {
    const certs = await prisma.certificate.findMany({
      where:   { dnaRecordId, ownerUserId: userId },
      orderBy: { issuedAt: 'desc' },
    });
    return certs.map(c => this.toDto(c));
  }

  async listAll(userId: string): Promise<IssuedCertificate[]> {
    const certs = await prisma.certificate.findMany({
      where: { ownerUserId: userId },
      orderBy: { issuedAt: 'desc' },
    });
    return certs.map(c => this.toDto(c));
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private buildPayload(certId: string, dnaId: string, vaultId: string, issuedAt: string): string {
    return `PINIT-DNA-CERT|${certId}|${dnaId}|${vaultId}|${issuedAt}`;
  }

  private sign(payload: string): string {
    return crypto.createHmac('sha256', this.signingSecret).update(payload).digest('hex');
  }

  private toDto(cert: {
    certificateId: string; dnaRecordId: string; vaultId: string;
    status: string; signature: string; issuedAt: Date; expiresAt?: Date | null;
    revokedAt?: Date | null; revocationReason?: string | null; issuedByUserId?: string | null;
  }): IssuedCertificate {
    return {
      certificateId:    cert.certificateId,
      dnaRecordId:      cert.dnaRecordId,
      vaultId:          cert.vaultId,
      status:           cert.status as CertificateStatus,
      signature:        cert.signature,
      issuedAt:         cert.issuedAt.toISOString(),
      expiresAt:        cert.expiresAt?.toISOString() ?? null,
      revokedAt:        cert.revokedAt?.toISOString() ?? null,
      revocationReason: cert.revocationReason ?? null,
      issuedByUserId:   cert.issuedByUserId ?? null,
    };
  }
}

export const certificateService = new CertificateService();
