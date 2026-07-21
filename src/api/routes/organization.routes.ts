import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { organizationController } from '../controllers/organization.controller';

export const organizationRouter = Router();

organizationRouter.get('/me', requireAuth, organizationController.getMine);
organizationRouter.post('/setup', requireAuth, organizationController.completeSetup);
organizationRouter.post('/welcome/skip', requireAuth, organizationController.skipWelcome);
