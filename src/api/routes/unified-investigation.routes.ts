/**
 * Unified Forensic Investigation Center routes
 */
import { Router } from 'express';
import { uploadInvestigation } from '../middleware/upload.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { unifiedInvestigate } from '../controllers/unified-investigation.controller';

const router = Router();

router.post('/unified-investigate', requireAuth, uploadInvestigation, unifiedInvestigate);

export { router as unifiedInvestigationRouter };
