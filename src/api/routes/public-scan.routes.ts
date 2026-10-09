import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.middleware';
import {
  defaultPublicScanDeps,
  getPublicScanDetails,
  getPublicScanSettings,
  getScanChallenge,
  postPublicScan,
  updatePublicScanSettings,
  type PublicScanDeps,
} from '../controllers/public-scan.controller';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function imageUpload(maxBytes: number) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
  });
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single('image')(req, res, (err: unknown) => {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
      if (code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ success: false, error: 'That image is too large. Use one under 12 MB.' });
        return;
      }
      if (err) {
        res.status(400).json({ success: false, error: 'Choose an image to scan.' });
        return;
      }
      next();
    });
  };
}

export function createPublicScanRouter(deps: PublicScanDeps = defaultPublicScanDeps, maxBytes = MAX_IMAGE_BYTES): Router {
  const router = Router();
  router.get('/challenge', getScanChallenge);
  router.get('/details/:token', (req, res) => getPublicScanDetails(req, res, deps));
  router.post('/', imageUpload(maxBytes), (req, res) => postPublicScan(req, res, deps));
  router.get('/settings/:vaultId', requireAuth, getPublicScanSettings);
  router.patch('/settings/:vaultId', requireAuth, updatePublicScanSettings);
  return router;
}

export const publicScanRouter = createPublicScanRouter();
