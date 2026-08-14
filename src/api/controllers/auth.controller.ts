import type { Request, Response, NextFunction } from 'express';
import { authService } from '../../services/auth/auth.service';
import { getAuthUserId } from '../../lib/tenant-scope';

export const authController = {
  async createAccount(_req: Request, res: Response) {
    res.status(403).json({
      success: false,
      error: 'Accounts are created only after face enrollment. Use biometric registration.',
    });
  },

  async login(_req: Request, res: Response) {
    res.status(403).json({
      success: false,
      error: 'Pinit ID login is disabled. Sign in with face verification.',
    });
  },

  async refresh(req: Request, res: Response) {
    const { refreshToken } = req.body as { refreshToken: string };
    if (!refreshToken) { res.status(400).json({ success: false, error: 'refreshToken required' }); return; }
    try {
      const tokens = await authService.refresh(refreshToken);
      res.json({ success: true, data: tokens });
    } catch {
      res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    }
  },

  async logout(req: Request, res: Response) {
    const { refreshToken } = req.body as { refreshToken: string };
    if (refreshToken) await authService.logout(refreshToken);
    res.json({ success: true });
  },

  async me(req: Request, res: Response) {
    res.json({ success: true, data: (req as any).user });
  },

  async setAccountType(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const { accountType, organizationName } = req.body as {
        accountType?: 'INDIVIDUAL' | 'BUSINESS';
        organizationName?: string;
      };
      if (accountType !== 'INDIVIDUAL' && accountType !== 'BUSINESS') {
        res.status(400).json({ success: false, error: 'accountType must be INDIVIDUAL or BUSINESS' });
        return;
      }
      const { biometricAuthService } = await import('../../services/auth/biometric-auth.service');
      const result = await biometricAuthService.updateAccountType(userId, accountType, organizationName);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async setupBusinessWorkspace(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const { organizationName, industry, organizationSize, workspaceName } = req.body as {
        organizationName?: string;
        industry?: string;
        organizationSize?: string;
        workspaceName?: string;
      };
      if (!organizationName?.trim()) {
        res.status(400).json({ success: false, error: 'organizationName is required' });
        return;
      }
      const { organizationService } = await import('../../services/organization/organization.service');
      const organization = await organizationService.completeSetup(userId, {
        organizationName,
        industry: industry as import('../../services/organization/constants/organization-profile').OrganizationIndustry | undefined,
        organizationSize: organizationSize as import('../../services/organization/constants/organization-profile').OrganizationSize | undefined,
        workspaceName,
      });
      res.json({ success: true, organization, completed: true });
    } catch (err) {
      next(err);
    }
  },

  async businessSetupStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const { organizationService } = await import('../../services/organization/organization.service');
      const organization = await organizationService.getForOwner(userId);
      res.json({
        success: true,
        completed: Boolean(organization?.setupCompletedAt),
        organization,
      });
    } catch (err) {
      next(err);
    }
  },
};
