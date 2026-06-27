import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { getTepManifest, listTepManifests } from '../controllers/tep.controller';

export const tepRouter = Router();

/** GET /tep/manifests?dnaRecordId=uuid — owner-only TEP lineage list */
tepRouter.get('/manifests', requireAuth, listTepManifests);

/** GET /tep/:tepCode — single manifest detail */
tepRouter.get('/:tepCode', requireAuth, getTepManifest);
