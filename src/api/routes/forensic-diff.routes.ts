import { Router } from 'express';
import { uploadComparison } from '../middleware/upload.middleware';
import { forensicDiff } from '../controllers/forensic-diff.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

/** POST /forensic/diff — Full forensic difference analysis between two files */
router.post('/diff', requireAuth, uploadComparison, forensicDiff);

export { router as forensicDiffRouter };
