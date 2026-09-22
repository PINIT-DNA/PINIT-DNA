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
import { publicAssetRecord } from './asset-record';
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

/**
 * How tightly the signature ties this certificate to a file.
 *
 *   SEALED — the signature covers the asset and the SHA-256 of its bytes, so the
 *            asset underneath cannot be swapped without breaking verification.
 *   LEGACY — issued before asset binding (v1). The signature covers certificate,
 *            DNA record, vault and issue time, but not the file hash.
 */
export type AssetBinding = 'SEALED' | 'LEGACY';

export interface VerificationOutcome {
  valid:           boolean;
  status:          CertificateStatus | 'NOT_FOUND';
  signatureValid:  boolean;
  certificateId:   string;
  detail:          string;
  certificate:     IssuedCertificate | null;
  /** Present once a signature has been matched. */
  assetBinding?:   AssetBinding;
  /** Public asset reference (PH-ASSET-XXXXXXXX) — never the raw Asset.id. */
  assetRecord?:    string | null;
  /** SHA-256 of the certified file, when one is recorded. */
  contentHash?:    string | null;
}

export { publicAssetRecord };

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
    const ownerUserId = params.ownerUserId;
    if (!ownerUserId) throw new Error('Certificate issue requires authenticated ownerUserId');
    const { assertRecordOwner } = await import('../../lib/tenant-scope');
    assertRecordOwner(dna.ownerUserId, ownerUserId, 'DNA record');

    const vault = await prisma.vaultRecord.findFirst({
      where: {
        id: params.vaultId,
        dnaRecordId: params.dnaRecordId,
        dnaRecord: { ownerUserId },
      },
      select: { id: true },
    });
    if (!vault) throw new Error('Vault record not found for this owner');

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

    // Bind the certificate to the exact file: Certificate → DNA → Vault → Asset →
    // SHA-256. Resolved BEFORE signing, so the asset is inside the signature rather
    // than attached to it afterwards. A file with no asset row or no recorded hash
    // is still certifiable — it signs the v1 payload, and verification says so.
    const asset = await this.resolveAsset(params.vaultId, params.dnaRecordId, ownerUserId);
    const sealed = Boolean(asset?.id && asset.contentHash);

    const payload = sealed
      ? this.buildPayloadV2({
          certId: certificateId,
          dnaId: params.dnaRecordId,
          vaultId: params.vaultId,
          assetId: asset!.id,
          contentHash: asset!.contentHash!,
          issuedAt: issuedAt.toISOString(),
        })
      : this.buildPayload(certificateId, params.dnaRecordId, params.vaultId, issuedAt.toISOString());
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
        // Part of the signed payload when sealed — recorded here so verification
        // rebuilds exactly what was signed.
        assetId: sealed ? asset!.id : null,
      },
    });

    logger.info('Certificate issued', {
      certificateId,
      dnaRecordId: params.dnaRecordId,
      assetBinding: sealed ? 'SEALED' : 'LEGACY',
    });

    // Link the certificate to the asset it certifies, in BOTH directions, so every
    // module resolves the same certificate for an asset instead of looking for one.
    // Asset.certificateId was never populated (0 of 38 assets in production), which
    // is what left Exchange with nothing canonical to show. Owner-scoped, additive,
    // and never overwrites a link that already exists.
    void this.linkToAsset(certificateId, params.vaultId, params.dnaRecordId, ownerUserId);

    try {
      const { forensicProvenanceService } = await import('../forensics/forensic-provenance.service');
      forensicProvenanceService.appendAsync({
        eventType: 'CERTIFICATE_ISSUED',
        summary: `Certificate issued — ${certificateId}`,
        dnaRecordId: params.dnaRecordId,
        vaultId: params.vaultId,
        certificateId,
        actorUserId: ownerUserId,
        payload: { expiresAt: expiresAt?.toISOString() ?? null },
        dedupeKey: `cert_issued:${certificateId}`,
      });
    } catch {
      /* non-fatal */
    }

    if (ownerUserId) {
      import('../platform-events/module-events').then(({ emitCertificateIssued }) => {
        emitCertificateIssued({
          ownerUserId,
          certificateId,
          dnaRecordId: params.dnaRecordId,
          vaultId: params.vaultId,
        });
      }).catch(() => {});
    }

    return this.toDto(cert);
  }

  /**
   * Point the asset at its certificate and the certificate at its asset.
   *
   * Best-effort: a missing Asset row (a vault protected before Asset identity
   * existed) leaves both sides as they are. Never creates an Asset, never issues a
   * certificate, never replaces an existing link.
   */
  private async linkToAsset(
    certificateId: string,
    vaultId: string,
    dnaRecordId: string,
    ownerUserId: string,
  ): Promise<void> {
    try {
      const asset = await prisma.asset.findFirst({
        where: { ownerUserId, OR: [{ vaultId }, { dnaId: dnaRecordId }] },
        select: { id: true, certificateId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!asset) return;

      if (!asset.certificateId) {
        await prisma.asset.update({
          where: { id: asset.id },
          data: { certificateId },
        });
      }
      await prisma.certificate.update({
        where: { certificateId },
        data: { assetId: asset.id },
      });
    } catch (err) {
      logger.warn('Certificate — asset link skipped (non-fatal)', { certificateId, error: String(err) });
    }
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

    // Verify the HMAC signature.
    //
    // A v2 certificate is checked against the asset and file hash AS THEY ARE NOW,
    // so substituting the asset underneath an issued certificate, or altering the
    // file, fails here. A v1 certificate keeps v1 semantics — its payload is never
    // rewritten, and it is reported as LEGACY rather than silently treated as sealed.
    const issuedAtIso = cert.issuedAt.toISOString();
    const asset = cert.assetId
      ? await prisma.asset.findUnique({
          where: { id: cert.assetId },
          select: { id: true, contentHash: true },
        })
      : null;

    const candidates: Array<{ binding: AssetBinding; payload: string }> = [];
    if (asset?.id && asset.contentHash) {
      candidates.push({
        binding: 'SEALED',
        payload: this.buildPayloadV2({
          certId: cert.certificateId,
          dnaId: cert.dnaRecordId,
          vaultId: cert.vaultId,
          assetId: asset.id,
          contentHash: asset.contentHash,
          issuedAt: issuedAtIso,
        }),
      });
    }
    candidates.push({
      binding: 'LEGACY',
      payload: this.buildPayload(cert.certificateId, cert.dnaRecordId, cert.vaultId, issuedAtIso),
    });

    const given = Buffer.from(cert.signature, 'hex');
    let matched: AssetBinding | null = null;
    for (const candidate of candidates) {
      const expected = Buffer.from(this.sign(candidate.payload), 'hex');
      if (expected.length === given.length && crypto.timingSafeEqual(given, expected)) {
        matched = candidate.binding;
        break;
      }
    }

    const signatureValid = matched !== null;
    const assetRecord = publicAssetRecord(cert.assetId);
    const contentHash = matched === 'SEALED' ? asset?.contentHash ?? null : null;

    if (!signatureValid) {
      if (cert.ownerUserId) {
        import('../platform-events/extended-events').then(({ emitCertificateVerified }) => {
          emitCertificateVerified({
            ownerUserId: cert.ownerUserId!,
            certificateId,
            valid: false,
          });
        }).catch(() => {});
      }
      return {
        valid: false, status: 'ACTIVE', signatureValid: false,
        certificateId,
        detail: cert.assetId
          ? 'Certificate signature is INVALID — the certificate, or the file it certifies, does not match what was issued'
          : 'Certificate signature is INVALID — possible forgery detected',
        certificate: this.toDto(cert),
        assetRecord,
      };
    }

    // Lifecycle only — the certificate record stays the source of truth, and who
    // checked it is never recorded (verification is public and anonymous).
    if (cert.ownerUserId) {
      import('../lifecycle/lifecycle-events').then(({ emitCertificateVerifiedOk }) => {
        emitCertificateVerifiedOk({
          ownerUserId: cert.ownerUserId!,
          certificateId,
          dnaRecordId: cert.dnaRecordId,
          vaultId: cert.vaultId,
        });
      }).catch(() => {});
    }

    return {
      valid: true, status: 'ACTIVE', signatureValid: true,
      certificateId,
      detail: matched === 'SEALED'
        ? 'Certificate is VALID — signature verified against this asset and its SHA-256, status ACTIVE'
        : 'Certificate is VALID — signature verified, status ACTIVE',
      certificate: this.toDto(cert),
      assetBinding: matched ?? 'LEGACY',
      assetRecord,
      contentHash,
    };
  }

  /**
   * What a stranger sees when they open a verification link.
   *
   * A certificate is meant to be shown — on a resume, in a portfolio, to a client —
   * so this returns enough to recognise it as real: what it certifies, who holds it,
   * when it was issued, and its live status. A revoked or expired certificate says so
   * here, which is the whole point of checking rather than trusting a screenshot.
   *
   * It deliberately does NOT return what verify() returns to internal callers: the
   * DNA record id, the vault id, the issuing user id, or the HMAC signature. A viewer
   * never needs them; they are internal keys other APIs are addressed by, and the
   * signature is the proof value itself.
   */
  async verifyPublic(certificateId: string): Promise<PublicCertificateView> {
    const outcome = await this.verify(certificateId);
    const cert = outcome.certificate;

    if (!cert) {
      return {
        valid: outcome.valid,
        status: outcome.status,
        signatureValid: outcome.signatureValid,
        certificateId: outcome.certificateId,
        detail: outcome.detail,
        certificate: null,
        subject: null,
        holder: null,
        assetRecord: outcome.assetRecord ?? null,
        contentHash: null,
        assetBinding: null,
        notice: CERTIFICATE_EVIDENCE_NOTICE,
      };
    }

    const row = await prisma.certificate.findUnique({
      where: { certificateId },
      select: { dnaRecordId: true, ownerUserId: true },
    });

    const [dna, owner] = await Promise.all([
      row?.dnaRecordId
        ? prisma.dnaRecord.findUnique({
            where: { id: row.dnaRecordId },
            select: { imageFilename: true, fileType: true, imageMimeType: true },
          })
        : null,
      row?.ownerUserId
        ? prisma.user.findUnique({
            where: { id: row.ownerUserId },
            // shortId IS the public PINIT ID; the raw user UUID is never exposed.
            select: { shortId: true, fullName: true },
          })
        : null,
    ]);

    return {
      valid: outcome.valid,
      status: outcome.status,
      signatureValid: outcome.signatureValid,
      certificateId: outcome.certificateId,
      detail: outcome.detail,
      certificate: {
        certificateId: cert.certificateId,
        status: cert.status,
        issuedAt: cert.issuedAt,
        expiresAt: cert.expiresAt ?? null,
        revokedAt: cert.revokedAt ?? null,
        revocationReason: cert.revocationReason ?? null,
      },
      subject: dna
        ? { title: dna.imageFilename, fileType: dna.fileType ?? mediaKindFromMime(dna.imageMimeType) }
        : null,
      holder: owner ? { name: owner.fullName ?? null, pinitId: owner.shortId ?? null } : null,
      assetRecord: outcome.assetRecord ?? null,
      contentHash: outcome.contentHash ?? null,
      assetBinding: outcome.assetBinding ?? null,
      notice: CERTIFICATE_EVIDENCE_NOTICE,
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
          if (params.vaultId && hinted.vaultId !== params.vaultId) {
            logger.warn('Certificate hint rejected — vault mismatch', {
              hint: params.hintCertificateId.slice(0, 12),
              expectedVault: params.vaultId.slice(0, 8),
              certVault: hinted.vaultId.slice(0, 8),
            });
          } else if (params.dnaRecordId && hinted.dnaRecordId !== params.dnaRecordId) {
            logger.warn('Certificate hint rejected — DNA mismatch', {
              hint: params.hintCertificateId.slice(0, 12),
              expectedDna: params.dnaRecordId.slice(0, 8),
              certDna: hinted.dnaRecordId.slice(0, 8),
            });
          } else {
            return this.toDto(hinted);
          }
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

    if (updated.ownerUserId) {
      import('../platform-events/module-events').then(({ emitCertificateRevoked }) => {
        emitCertificateRevoked({
          ownerUserId: updated.ownerUserId!,
          certificateId,
          dnaRecordId: updated.dnaRecordId,
          reason,
        });
      }).catch(() => {});
    }

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

  /** v1 — certificates issued before asset binding. Never change this string. */
  private buildPayload(certId: string, dnaId: string, vaultId: string, issuedAt: string): string {
    return `PINIT-DNA-CERT|${certId}|${dnaId}|${vaultId}|${issuedAt}`;
  }

  /**
   * v2 — Certificate → DNA → Vault → Asset → the exact bytes.
   *
   * Because the asset id and the SHA-256 of its content are inside the signed
   * string, pointing an issued certificate at a different asset, or altering the
   * file it certifies, makes verification fail instead of silently passing.
   */
  private buildPayloadV2(params: {
    certId: string; dnaId: string; vaultId: string;
    assetId: string; contentHash: string; issuedAt: string;
  }): string {
    return [
      'PINIT-CERT-V2',
      params.certId, params.dnaId, params.vaultId,
      params.assetId, params.contentHash, params.issuedAt,
    ].join('|');
  }

  /**
   * The asset a certificate belongs to, owner-scoped.
   *
   * Vault and DNA are how a certificate is addressed; Asset.id is the canonical
   * identity the rest of the platform uses. They stay separate identifiers — this
   * only resolves between them.
   */
  private async resolveAsset(
    vaultId: string,
    dnaRecordId: string,
    ownerUserId: string,
  ): Promise<{ id: string; contentHash: string | null } | null> {
    return prisma.asset.findFirst({
      where: { ownerUserId, OR: [{ vaultId }, { dnaId: dnaRecordId }] },
      select: { id: true, contentHash: true },
      orderBy: { createdAt: 'desc' },
    });
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

/** The public projection of a certificate — no internal ids, no signature. */
export interface PublicCertificateView {
  valid: boolean;
  status: string;
  signatureValid: boolean;
  certificateId: string;
  detail: string;
  certificate: {
    certificateId: string;
    status: string;
    issuedAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    revocationReason: string | null;
  } | null;
  /** What the certificate is about. */
  subject: { title: string; fileType: string } | null;
  /** Who holds it, by public identity only. */
  holder: { name: string | null; pinitId: string | null } | null;
  /** Public asset reference (PH-ASSET-XXXXXXXX). Never the raw Asset.id. */
  assetRecord: string | null;
  /** SHA-256 of the certified file — the integrity record, shown only when sealed. */
  contentHash: string | null;
  /** SEALED = signature covers the asset and its hash; LEGACY = issued before that. */
  assetBinding: AssetBinding | null;
  /** What this certificate does and does not establish. */
  notice: string;
}

/**
 * The evidence-record notice, served with every public verification so the page
 * and the printed sheet say the same thing. Pinit records and verifies evidence;
 * it is not a registration authority and does not adjudicate ownership.
 */
export const CERTIFICATE_EVIDENCE_NOTICE =
  'This certificate records a protected digital asset and its associated evidence on Pinit HUB. ' +
  'It is not a government-issued copyright registration and does not constitute a legal determination ' +
  'of ownership, infringement, or other legal rights.';

/** Coarse media kind for display when a record predates the fileType column. */
function mediaKindFromMime(mime: string): string {
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime === 'application/pdf') return 'PDF';
  return 'DOCUMENT';
}

export const certificateService = new CertificateService();
