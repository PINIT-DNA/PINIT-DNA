import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { getMyCredentialHandler, listMyCredentialsHandler } from '../controllers/credentials.controller';

const router = Router();

router.get('/me', requireAuth, listMyCredentialsHandler);
router.get('/:credentialId', requireAuth, getMyCredentialHandler);

export { router as credentialsRouter };
