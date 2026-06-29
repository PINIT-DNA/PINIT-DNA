/**
 * Phase 3 — Evidence verification & report signing API
 */
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/error.middleware';
import {
  verifyReportManifest,
  signReportManifest,
  buildReportId,
  getEvidencePublicKey,
  type ReportManifest,
  type SignedReportManifest,
} from '../../services/evidence/report-signing.service';
import { sha256Hex } from '../../services/evidence/phase3-crypto.service';
import { isPhase3SignedReportsActive } from '../../config/dna-phase3';
import { getAuthUserId } from '../../lib/tenant-scope';

export async function getEvidencePublicKeyHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const key = getEvidencePublicKey();
  res.json({ success: true, ...key });
}

export async function verifyEvidenceReport(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!isPhase3SignedReportsActive()) {
      return next(new AppError(503, 'Report verification is disabled (DNA_PHASE3_ENABLED=false)'));
    }

    const { reportId } = req.params;
    const hashParam = (req.query.hash as string) ?? '';

    if (req.method === 'POST' && req.body?.manifest) {
      const manifest = req.body.manifest as SignedReportManifest;
      if (manifest.reportId !== reportId) {
        res.status(400).json({ success: false, valid: false, detail: 'Report ID mismatch' });
        return;
      }
      const result = verifyReportManifest(manifest);
      const hashMatch = !hashParam || manifest.reportHash === hashParam;
      res.json({
        success: true,
        reportId,
        valid: result.valid && hashMatch,
        signatureValid: result.signatureValid,
        hashMatch,
        detail: hashMatch ? result.detail : 'Report hash mismatch',
        verifiedAt: new Date().toISOString(),
      });
      return;
    }

    res.json({
      success: true,
      reportId,
      valid: false,
      detail: 'Submit manifest via POST body or include signed EvidenceManifest.json from package',
      verifyEndpoint: `/api/v1/evidence/verify/${reportId}`,
      hint: 'Pass ?hash=<sha256> to validate hash alongside signature',
    });
  } catch (err) {
    next(err);
  }
}

export async function signReportManifestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!isPhase3SignedReportsActive()) {
      return next(new AppError(503, 'Report signing is disabled'));
    }

    getAuthUserId(req);

    const {
      investigationId,
      reportType,
      reportHash,
      certificateStatus,
      contentForHash,
    } = req.body as {
      investigationId: string;
      reportType: ReportManifest['reportType'];
      reportHash?: string;
      certificateStatus?: string;
      contentForHash?: string;
    };

    if (!investigationId || !reportType) {
      return next(new AppError(400, 'investigationId and reportType required'));
    }

    const hash = reportHash ?? (contentForHash ? sha256Hex(contentForHash) : '');
    if (!hash) {
      return next(new AppError(400, 'reportHash or contentForHash required'));
    }

    const reportId = buildReportId(investigationId, reportType);
    const signed = signReportManifest({
      reportId,
      reportType,
      investigationId,
      reportHash: hash,
      issuedAt: new Date().toISOString(),
      certificateStatus,
      engineVersion: '2.3-phase3',
    });

    if (!signed) {
      return next(new AppError(500, 'Failed to sign manifest'));
    }

    res.json({ success: true, manifest: signed });
  } catch (err) {
    next(err);
  }
}
