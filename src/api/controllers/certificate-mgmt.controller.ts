/**
 * PINIT-DNA — Certificate Management Controller (Phase 2)
 *
 * POST /api/v1/certificates/issue          — Issue certificate for a vault record
 * GET  /api/v1/certificates/verify/:id     — Verify certificate (replaces frontend-only)
 * POST /api/v1/certificates/revoke/:id     — Revoke a certificate
 * GET  /api/v1/certificates                — List all certificates
 * GET  /api/v1/certificates/dna/:dnaId     — Certificates for a DNA record
 */

import { Request, Response, NextFunction } from 'express';
import { certificateService } from '../../services/certificates/certificate.service';
import { auditService }       from '../../services/audit/audit.service';
import { AppError }           from '../middleware/error.middleware';

// ─── POST /certificates/issue ─────────────────────────────────────────────────

export async function issueCertificate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { dnaRecordId, vaultId, expiresInDays } = req.body as {
    dnaRecordId: string; vaultId: string; expiresInDays?: number;
  };

  if (!dnaRecordId || !vaultId) {
    return next(new AppError(400, 'dnaRecordId and vaultId are required'));
  }

  try {
    const cert = await certificateService.issue({ dnaRecordId, vaultId, expiresInDays });

    await auditService.log({
      eventType: 'CERTIFICATE_ISSUED', dnaRecordId, vaultId: cert.vaultId,
      detail: { certificateId: cert.certificateId, status: cert.status }, req,
    });

    res.status(201).json({ success: true, certificate: cert });
  } catch (err) {
    next(err);
  }
}

// ─── GET /certificates/verify/:certificateId ──────────────────────────────────

export async function verifyCertificate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { certificateId } = req.params;
  try {
    const result = await certificateService.verify(certificateId);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

// ─── POST /certificates/revoke/:certificateId ─────────────────────────────────

export async function revokeCertificate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { certificateId } = req.params;
  const { reason } = req.body as { reason?: string };

  if (!reason?.trim()) {
    return next(new AppError(400, 'Revocation reason is required'));
  }

  try {
    const cert = await certificateService.revoke(certificateId, reason.trim());

    await auditService.log({
      eventType: 'CERTIFICATE_REVOKED', dnaRecordId: cert.dnaRecordId, vaultId: cert.vaultId,
      detail: { certificateId, reason }, req,
    });

    res.status(200).json({ success: true, certificate: cert });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found'))  return next(new AppError(404, err.message));
    if (err instanceof Error && err.message.includes('already'))    return next(new AppError(409, err.message));
    next(err);
  }
}

// ─── GET /certificates ────────────────────────────────────────────────────────

export async function listCertificates(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const certs = await certificateService.listAll();
    res.status(200).json({ success: true, count: certs.length, certificates: certs });
  } catch (err) {
    next(err);
  }
}

// ─── GET /certificates/dna/:dnaRecordId ──────────────────────────────────────

export async function listCertificatesByDna(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const certs = await certificateService.listByDnaRecord(req.params['dnaRecordId']);
    res.status(200).json({ success: true, count: certs.length, certificates: certs });
  } catch (err) {
    next(err);
  }
}
