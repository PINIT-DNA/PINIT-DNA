import { Router } from 'express';
import { presignUpload, confirmPresignedUpload } from '../controllers/upload-presign.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.post('/presign', requireAuth, presignUpload);
router.post('/presign/complete', requireAuth, confirmPresignedUpload);

export { router as uploadPresignRouter };
