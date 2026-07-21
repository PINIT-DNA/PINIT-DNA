import { Router } from 'express';
import { uploadComparison } from '../middleware/upload.middleware';
import { forensicDiff } from '../controllers/forensic-diff.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { requireFeature, FeatureKey } from '../../services/subscription';

const router = Router();

/** POST /forensic/diff — Full forensic difference analysis between two files */
router.post(
  '/diff',
  requireAuth,
  requireFeature(FeatureKey.FEATURE_INVESTIGATION),
  uploadComparison,
  forensicDiff,
);

export { router as forensicDiffRouter };
