import type { Request, Response, NextFunction } from 'express';
import { authService } from '../../services/auth/auth.service';
import { getAuthUserId } from '../../lib/tenant-scope';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../../lib/auth-cookies';
import { prisma } from '../../lib/prisma';

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
    const bodyToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    const refreshToken = (typeof bodyToken === 'string' && bodyToken.trim()) || readRefreshCookie(req);
    if (!refreshToken) { res.status(400).json({ success: false, error: 'refreshToken required' }); return; }
    try {
      const tokens = await authService.refresh(refreshToken);
      setRefreshCookie(req, res, tokens.refreshToken);
      res.json({ success: true, data: { accessToken: tokens.accessToken } });
    } catch {
      clearRefreshCookie(req, res);
      res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
    }
  },

  async logout(req: Request, res: Response) {
    const bodyToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    const refreshToken = (typeof bodyToken === 'string' && bodyToken.trim()) || readRefreshCookie(req);
    if (refreshToken) await authService.logout(refreshToken);
    clearRefreshCookie(req, res);
    res.json({ success: true });
  },

  async me(req: Request, res: Response) {
    const payload = (req as { user?: {
      sub?: string;
      shortId?: string;
      name?: string;
      role?: string;
      accountType?: string;
    } }).user;
    if (!payload?.sub) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    try {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          shortId: true,
          fullName: true,
          role: true,
          isActive: true,
          accountType: true,
          ownedOrganization: { select: { id: true, setupCompletedAt: true } },
        },
      });
      if (!user || !user.isActive) {
        res.status(401).json({ success: false, error: 'Session is no longer valid' });
        return;
      }
      const accountType = user.accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';
      res.json({
        success: true,
        data: {
          sub: user.id,
          shortId: user.shortId,
          name: user.fullName,
          role: user.role,
          accountType,
          capabilities: {
            buyer_enabled: true,
            can_purchase: true,
            business: accountType === 'BUSINESS',
            business_setup_complete: Boolean(user.ownedOrganization?.setupCompletedAt),
          },
        },
      });
    } catch {
      res.json({
        success: true,
        data: {
          ...payload,
          capabilities: {
            buyer_enabled: true,
            can_purchase: true,
            business: payload.accountType === 'BUSINESS',
          },
        },
      });
    }
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
