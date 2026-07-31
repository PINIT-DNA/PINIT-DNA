/**
 * Publish Guardian + Protected Posts routes (additive module).
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth.middleware';
import { config } from '../../config';
import {
  publishProtect,
  registerPost,
  listProtectedPosts,
  getProtectedPost,
  updateProtectedPost,
  deleteProtectedPost,
  getProtectedPostsStats,
  syncExtensionState,
} from '../controllers/publish-guardian.controller';

const router = Router();

if (!fs.existsSync(config.upload.tempDir)) {
  fs.mkdirSync(config.upload.tempDir, { recursive: true });
}

const extensionUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.upload.tempDir),
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const random = Math.random().toString(36).slice(2, 8);
      const ext = path.extname(file.originalname) || '.bin';
      cb(null, `pg_${timestamp}_${random}${ext}`);
    },
  }),
  limits: { fileSize: config.upload.maxFileSizeBytes ?? 500 * 1024 * 1024 },
});

/** Accept either "media" (extension) or "image" (legacy alias). */
function uploadMedia(req: Parameters<typeof publishProtect>[0], res: Parameters<typeof publishProtect>[1], next: Parameters<typeof publishProtect>[2]) {
  const handler = extensionUpload.fields([
    { name: 'media', maxCount: 1 },
    { name: 'image', maxCount: 1 },
  ]);
  handler(req, res, (err) => {
    if (err) return next(err);
    const files = (req as { files?: { media?: Express.Multer.File[]; image?: Express.Multer.File[] } }).files;
    const file = files?.media?.[0] ?? files?.image?.[0];
    if (file) (req as { file?: Express.Multer.File }).file = file;
    next();
  });
}

router.post('/extension/publish-protect', requireAuth, uploadMedia, publishProtect);
router.post('/extension/register-post', requireAuth, registerPost);
router.get('/extension/sync', requireAuth, syncExtensionState);

router.get('/posts/stats', requireAuth, getProtectedPostsStats);
router.get('/posts', requireAuth, listProtectedPosts);
router.get('/posts/:id', requireAuth, getProtectedPost);
router.patch('/posts/:id', requireAuth, updateProtectedPost);
router.delete('/posts/:id', requireAuth, deleteProtectedPost);

export { router as publishGuardianRouter };
