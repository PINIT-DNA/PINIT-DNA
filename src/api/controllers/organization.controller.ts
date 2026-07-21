import type { Request, Response, NextFunction } from 'express';
import { getAuthUserId } from '../../lib/tenant-scope';
import { organizationService } from '../../services/organization/organization.service';
import type { OrganizationIndustry } from '../../services/organization/constants/organization-profile';

export const organizationController = {
  async getMine(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const organization = await organizationService.ensureForOwner(userId);
      res.json({ success: true, organization });
    } catch (err) {
      next(err);
    }
  },

  async skipWelcome(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const organization = await organizationService.skipWelcome(userId);
      res.json({ success: true, organization });
    } catch (err) {
      next(err);
    }
  },

  async completeSetup(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const { organizationName, industry, country, workspaceName, logoUrl } = req.body as {
        organizationName?: string;
        industry?: string;
        country?: string;
        workspaceName?: string;
        logoUrl?: string | null;
      };
      if (!organizationName?.trim()) {
        res.status(400).json({ success: false, error: 'organizationName is required' });
        return;
      }
      const organization = await organizationService.completeSetup(userId, {
        organizationName,
        industry: industry as OrganizationIndustry | undefined,
        country,
        workspaceName,
        logoUrl: logoUrl ?? null,
      });
      res.json({ success: true, organization });
    } catch (err) {
      next(err);
    }
  },
};
