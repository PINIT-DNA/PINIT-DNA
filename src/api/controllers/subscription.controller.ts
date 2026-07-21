import { Request, Response, NextFunction } from 'express';
import { getAuthUserId } from '../../lib/tenant-scope';
import { entitlementService, subscriptionService } from '../../services/subscription';
import { PlanCode } from '../../services/subscription/constants/plans';
import { AppError } from '../middleware/error.middleware';
import { razorpayBillingService } from '../../services/subscription/billing/razorpay.service';
import { mockBillingService } from '../../services/subscription/billing/mock-billing.service';
import { config } from '../../config';

/** GET /subscription/me */
export async function getMySubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const view = await entitlementService.getSubscriptionView(userId);
    res.json({ success: true, subscription: view });
  } catch (err) {
    next(err);
  }
}

/** GET /subscription/plans */
export async function listSubscriptionPlans(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const plans = await subscriptionService.listPlans();
    const razorpay = razorpayBillingService.getPublicConfig();
    res.json({ success: true, plans, razorpay });
  } catch (err) {
    next(err);
  }
}

/** GET /subscription/billing/config — public key for Checkout */
export async function getBillingConfig(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ success: true, razorpay: razorpayBillingService.getPublicConfig() });
  } catch (err) {
    next(err);
  }
}

/** POST /subscription/billing/create-order { planCode } */
export async function createRazorpayOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const { planCode } = req.body as { planCode?: string };
    if (!planCode || !Object.values(PlanCode).includes(planCode as PlanCode)) {
      throw new AppError(400, 'Valid planCode required (PRO | ENTERPRISE)');
    }
    if (planCode === PlanCode.FREE) {
      throw new AppError(400, 'Free plan does not require payment');
    }
    const order = await razorpayBillingService.createOrder(userId, planCode as PlanCode);
    res.json({ success: true, order });
  } catch (err) {
    next(err);
  }
}

/** POST /subscription/billing/verify { planCode, razorpay_order_id, razorpay_payment_id, razorpay_signature } */
export async function verifyRazorpayPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const {
      planCode,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body as {
      planCode?: string;
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    };

    if (!planCode || !Object.values(PlanCode).includes(planCode as PlanCode)) {
      throw new AppError(400, 'Valid planCode required');
    }
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new AppError(400, 'Missing Razorpay payment fields');
    }

    const result = await razorpayBillingService.verifyAndActivate({
      userId,
      planCode: planCode as PlanCode,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    });

    const view = await entitlementService.getSubscriptionView(userId);
    res.json({ success: true, ...result, subscription: view });
  } catch (err) {
    next(err);
  }
}

/** GET /subscription/billing/history */
export async function getBillingHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const history = await mockBillingService.listHistory(userId);
    res.json({ success: true, history });
  } catch (err) {
    next(err);
  }
}

/** POST /subscription/billing/mock-complete { planCode, paymentMethod?, coupon? } */
export async function mockCompletePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const { planCode, paymentMethod, coupon } = req.body as {
      planCode?: string;
      paymentMethod?: string;
      coupon?: string;
    };

    if (!planCode || !Object.values(PlanCode).includes(planCode as PlanCode)) {
      throw new AppError(400, 'Valid planCode required (PRO | ENTERPRISE)');
    }

    const result = await mockBillingService.completePayment({
      userId,
      planCode: planCode as PlanCode,
      paymentMethod,
      coupon,
    });

    const view = await entitlementService.getSubscriptionView(userId);
    res.json({ success: true, payment: result, subscription: view });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /subscription/assign — FREE self-downgrade, or admin assign any plan.
 * Paid upgrades must go through Razorpay (except non-production demo when keys missing).
 */
export async function assignSubscriptionPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const callerId = getAuthUserId(req);
    const { planCode, userId } = req.body as { planCode?: string; userId?: string };
    if (!planCode || !Object.values(PlanCode).includes(planCode as PlanCode)) {
      throw new AppError(400, 'Valid planCode required (FREE | PRO | ENTERPRISE)');
    }

    const targetUserId = userId?.trim() || callerId;
    const { prisma } = await import('../../lib/prisma');
    const caller = await prisma.user.findUnique({ where: { id: callerId }, select: { role: true } });
    const isAdmin = caller?.role === 'ADMIN' || caller?.role === 'SUPER_ADMIN';

    if (targetUserId !== callerId && !isAdmin) {
      throw new AppError(403, 'Admin access required to assign plans to other users');
    }

    const paidPlan = planCode === PlanCode.PRO || planCode === PlanCode.ENTERPRISE;
    const demoAllowed =
      config.env !== 'production' && !razorpayBillingService.getPublicConfig().configured;

    if (paidPlan && !isAdmin && !demoAllowed) {
      throw new AppError(
        402,
        'Payment required. Use Razorpay checkout to upgrade to this plan.',
      );
    }

    await subscriptionService.assignPlan(targetUserId, planCode as PlanCode);
    const view = await entitlementService.getSubscriptionView(targetUserId);
    res.json({
      success: true,
      subscription: view,
      demo: demoAllowed && paidPlan && !isAdmin,
    });
  } catch (err) {
    next(err);
  }
}
