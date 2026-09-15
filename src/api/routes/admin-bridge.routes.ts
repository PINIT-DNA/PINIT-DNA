/**
 * PinitHUB Master Admin bridge routes
 *
 * Owner auth (Hub JWT):
 *   GET  /admin-bridge/config
 *   POST /admin-bridge/sso
 *
 * Public (bridge token is the credential):
 *   POST /admin-bridge/exchange
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  getAdminBridgeConfig,
  createAdminBridgeToken,
  exchangeAdminBridgeToken,
} from '../controllers/admin-bridge.controller';

const router = Router();

router.get('/config', requireAuth, getAdminBridgeConfig);
router.post('/sso', requireAuth, createAdminBridgeToken);
router.post('/exchange', exchangeAdminBridgeToken);

export const adminBridgeRouter = router;
