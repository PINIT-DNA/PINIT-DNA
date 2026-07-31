import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireAdminOrSuper } from '../middleware/role.middleware';
import {
  getMySubscription,
  listSubscriptionPlans,
  assignSubscriptionPlan,
  getBillingConfig,
  createRazorpayOrder,
  verifyRazorpayPayment,
  getBillingHistory,
  mockCompletePayment,
} from '../controllers/subscription.controller';

const router = Router();

router.get('/me', requireAuth, getMySubscription);
router.get('/plans', requireAuth, listSubscriptionPlans);
router.get('/billing/config', requireAuth, getBillingConfig);
router.post('/billing/create-order', requireAuth, createRazorpayOrder);
router.post('/billing/verify', requireAuth, verifyRazorpayPayment);
router.get('/billing/history', requireAuth, getBillingHistory);
router.post('/billing/mock-complete', requireAuth, mockCompletePayment);

/** FREE self-downgrade / admin assign / local demo when Razorpay keys missing */
router.post('/assign', requireAuth, assignSubscriptionPlan);
router.post('/admin/assign', requireAuth, requireAdminOrSuper, assignSubscriptionPlan);

export { router as subscriptionRouter };
