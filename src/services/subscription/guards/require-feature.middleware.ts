/**
 * Express guard — requireFeature(FEATURE_X) after requireAuth.
 */

import { Request, Response, NextFunction } from 'express';
import type { FeatureKey } from '../constants/features';
import {
  entitlementService,
  SubscriptionRequiredError,
} from '../entitlements/entitlement.service';
import { getAuthUserId } from '../../../lib/tenant-scope';

export function requireFeature(feature: FeatureKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = getAuthUserId(req);
      await entitlementService.assertFeature(userId, feature);
      next();
    } catch (err) {
      if (err instanceof SubscriptionRequiredError) {
        res.status(403).json({
          success: false,
          error: 'Subscription Required',
          requiredPlan: err.requiredPlan,
          feature: err.feature,
        });
        return;
      }
      next(err);
    }
  };
}
