/**
 * PINIT-DNA — File Upload Middleware (Multer)
 *
 * Phase 0+: Accepts ALL supported file types, not just images.
 * The UniversalFileRouter (downstream) enforces which types have live engines.
 *
 * Two named exports:
 *   uploadSingle — legacy field name "image" (backward compatible with all
 *                  existing routes and the frontend)
 *   uploadFile   — universal alias using field name "file" (for new routes)
 *
 * Both share the same storage, filter, and size limits.
 */

import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';
import { config } from '../../config';
import { mimeMatchesAllowed } from '../../lib/mime-normalize';

// Ensure temp directory exists at startup
if (!fs.existsSync(config.upload.tempDir)) {
  fs.mkdirSync(config.upload.tempDir, { recursive: true });
}

// ─── Shared disk storage ──────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.upload.tempDir),
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    // Include random suffix so two files in the same request (e.g. compare)
    // never collide on the same disk filename.
    const random = Math.random().toString(36).slice(2, 8);
    const ext = path.extname(file.originalname);
    cb(null, `dna_${timestamp}_${random}${ext}`);
  },
});

// ─── MIME filter — accepts all types known to the supported-file-types config ─

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
): void => {
  if (mimeMatchesAllowed(file.mimetype, config.upload.allowedMimeTypes)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Unsupported file type: "${file.mimetype}". ` +
        `Supported: IMAGE, PDF, DOCX, PPTX, TXT, CSV, JSON, ZIP, VIDEO, AUDIO. ` +
        `Check GET /api/v1/dna/supported-types for the full MIME list.`
      )
    );
  }
};

// ─── Multer instance (shared config) ─────────────────────────────────────────

const multerInstance = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.upload.maxFileSizeBytes },
});

/**
 * uploadSingle — field name "image"
 * Used by all existing routes.  Backward compatible with the frontend.
 */
export const uploadSingle = multerInstance.single('image');

/**
 * uploadFile — field name "file"
 * Use this for new Universal DNA routes that are not image-specific.
 */
export const uploadFile = multerInstance.single('file');

/**
 * uploadComparison — two fields: "fileA" and "fileB"
 * Used exclusively by POST /api/v1/dna/compare
 */
export const uploadComparison = multerInstance.fields([
  { name: 'fileA', maxCount: 1 },
  { name: 'fileB', maxCount: 1 },
]);
