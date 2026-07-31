/**
 * Universal Asset routes (additive — does not replace Protected Posts routes).
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth.middleware';
import { config } from '../../config';
import {
  protectAsset,
  listAssets,
  getAsset,
  getAssetStats,
  transitionAsset,
} from '../controllers/asset.controller';

const router = Router();

if (!fs.existsSync(config.upload.tempDir)) {
  fs.mkdirSync(config.upload.tempDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.upload.tempDir),
    filename: (_req, file, cb) => {
      const timestamp = Date.now();
      const random = Math.random().toString(36).slice(2, 8);
      const ext = path.extname(file.originalname) || '.bin';
      cb(null, `asset_${timestamp}_${random}${ext}`);
    },
  }),
  limits: { fileSize: config.upload.maxFileSizeBytes ?? 500 * 1024 * 1024 },
});

function uploadMedia(req: Parameters<typeof protectAsset>[0], res: Parameters<typeof protectAsset>[1], next: Parameters<typeof protectAsset>[2]) {
  const handler = upload.fields([
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

router.post('/assets/protect', requireAuth, uploadMedia, protectAsset);
router.get('/assets/stats', requireAuth, getAssetStats);
router.get('/assets', requireAuth, listAssets);
router.get('/assets/:id', requireAuth, getAsset);
router.patch('/assets/:id/status', requireAuth, transitionAsset);

export { router as assetRouter };
