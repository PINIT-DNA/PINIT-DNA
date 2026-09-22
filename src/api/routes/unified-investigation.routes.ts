/**
 * Unified Forensic Investigation Center routes
 */
import { Router } from 'express';
import { uploadInvestigation } from '../middleware/upload.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { requireFeature, FeatureKey } from '../../services/subscription';
import { unifiedInvestigate, getInvestigationProbeThumbnail } from '../controllers/unified-investigation.controller';

const router = Router();

router.post(
  '/unified-investigate',
  requireAuth,
  requireFeature(FeatureKey.FEATURE_INVESTIGATION),
  uploadInvestigation,
  unifiedInvestigate,
);

router.get(
  '/investigation/:investigationId/probe-thumbnail',
  requireAuth,
  getInvestigationProbeThumbnail,
);

export { router as unifiedInvestigationRouter };
