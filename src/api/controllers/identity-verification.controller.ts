/**
 * Identity Proof Analysis and Verification — owner endpoints.
 *
 * POST /profile/identity-verification/analyze
 *   multipart: documents (1–4 files), documentTypes (JSON array, optional per file),
 *              documentFaces (JSON array of { embedding, detectionScore?, relativeSize? } | null, optional),
 *              live (JSON { embedding, padEvidence? }, optional),
 *              documentBack (optional back side of the first document),
 *              includeSavedProof ("true" to compare with the saved ID proof's earlier results)
 * GET  /profile/identity-verification/latest
 *
 * Analysis does not store the files. Each run is recorded (encrypted) for audit.
 */
import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import {
  identityVerificationService, isIdentityDocumentType, ownerView, type UploadedDocument,
} from '../../services/identity-verification/identity-verification.service';
import type { DeviceFace, LiveCapture } from '../../services/identity-verification/types';

const DOC_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);
export const MAX_DOCUMENTS = 4;

export const identityDocumentsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: MAX_DOCUMENTS + 1 }, // + one back side
  fileFilter: (_req, file, cb) => {
    if (DOC_MIMES.has(file.mimetype.toLowerCase())) cb(null, true);
    else cb(new Error('Use a JPG, PNG, WEBP, or PDF of the document.'));
  },
});

function userId(req: Request): string {
  return (req as Request & { user?: { sub?: string } }).user?.sub ?? '';
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return Symbol.for('invalid');
  }
}

function embeddingOk(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === 128 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

/**
 * A face found on a document photograph by the device.
 * "null" (the JSON literal) = examined, no face; anything unusable = not examined.
 */
export function parseDeviceFace(raw: unknown): DeviceFace | null | undefined {
  const v = typeof raw === 'string' ? parseJson(raw) : raw;
  if (v === null) return null;
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (!embeddingOk(o.embedding)) return undefined;
  return {
    embedding: o.embedding,
    detectionScore: typeof o.detectionScore === 'number' ? o.detectionScore : undefined,
    relativeSize: typeof o.relativeSize === 'number' ? o.relativeSize : undefined,
  };
}

export function parseAnalyzeBody(body: Record<string, unknown>, fileCount: number):
  { ok: true; types: Array<UploadedDocument['declaredType']>; faces: Array<DeviceFace | null | undefined>; live: LiveCapture | null }
  | { ok: false; error: string } {
  const types = parseJson(body.documentTypes);
  if (types === Symbol.for('invalid') || (types !== undefined && !Array.isArray(types))) {
    return { ok: false, error: 'documentTypes must be a JSON array.' };
  }
  const declared = Array.from({ length: fileCount }, (_, i) => {
    const t = (types as unknown[] | undefined)?.[i];
    return isIdentityDocumentType(t) ? t : null;
  });

  const facesRaw = parseJson(body.documentFaces);
  if (facesRaw === Symbol.for('invalid') || (facesRaw !== undefined && !Array.isArray(facesRaw))) {
    return { ok: false, error: 'documentFaces must be a JSON array.' };
  }
  const faces = Array.from({ length: fileCount }, (_, i) => {
    const f = (facesRaw as unknown[] | undefined)?.[i];
    return f === undefined ? undefined : parseDeviceFace(f);
  });

  const liveRaw = parseJson(body.live);
  if (liveRaw === Symbol.for('invalid')) return { ok: false, error: 'live must be JSON.' };
  let live: LiveCapture | null = null;
  if (liveRaw && typeof liveRaw === 'object') {
    const o = liveRaw as Record<string, unknown>;
    if (!embeddingOk(o.embedding)) return { ok: false, error: 'The live face capture is not valid. Scan again.' };
    live = { embedding: o.embedding, padEvidence: o.padEvidence };
  }
  return { ok: true, types: declared, faces, live };
}

export async function analyzeIdentityDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    const uploaded = (req as Request & { files?: Record<string, Express.Multer.File[]> }).files ?? {};
    const files = (uploaded.documents ?? []).filter((f) => f.buffer?.length);
    // An optional back side belongs to the first document (e.g. the Aadhaar address side).
    const back = uploaded.documentBack?.[0];
    if (!files.length) {
      res.status(400).json({ success: false, error: 'Add at least one identity document.' });
      return;
    }
    const parsed = parseAnalyzeBody(req.body ?? {}, files.length);
    if (!parsed.ok) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }
    const { result, runId } = await identityVerificationService.verify({
      userId: userId(req),
      documents: files.map((f, i) => ({
        bytes: f.buffer,
        mimeType: f.mimetype,
        declaredType: parsed.types[i],
        documentFace: parsed.faces[i],
        ...(i === 0 && back?.buffer?.length ? { backBytes: back.buffer, backMimeType: back.mimetype } : {}),
      })),
      live: parsed.live,
      trigger: 'ANALYZE',
      includeSavedProof: String(req.body?.includeSavedProof ?? '') === 'true',
    });
    res.json({ success: true, runId, verification: ownerView(result) });
  } catch (err) { next(err); }
}

export async function getLatestIdentityVerification(req: Request, res: Response, next: NextFunction) {
  try {
    const latest = await identityVerificationService.latestForOwner(userId(req));
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      verification: latest ? { id: latest.id, createdAt: latest.createdAt, ...ownerView(latest.result) } : null,
    });
  } catch (err) { next(err); }
}
