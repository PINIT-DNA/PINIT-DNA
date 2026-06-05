import { Router } from 'express';
import { uploadComparison } from '../middleware/upload.middleware';
import { forensicDiff } from '../controllers/forensic-diff.controller';

const router = Router();

/** POST /forensic/diff — Full forensic difference analysis between two files */
router.post('/diff', uploadComparison, forensicDiff);

export { router as forensicDiffRouter };
