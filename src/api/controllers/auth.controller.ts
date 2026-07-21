import type { Request, Response, NextFunction } from 'express';
import { authService } from '../../services/auth/auth.service';
import { resolveClientIp } from '../../lib/request-utils';
import { getAuthUserId } from '../../lib/tenant-scope';
import { notifyLoginSuccess, notifyLoginFailed, notifyUserRegistered } from '../../services/platform-events/account-events';
import { prisma } from '../../lib/prisma';

export const authController = {
  async createAccount(_req: Request, res: Response) {
    const result = await authService.createAccount();
    notifyUserRegistered(result.user.id, result.user.shortId);
    res.status(201).json({ success: true, data: result });
  },

  async login(req: Request, res: Response) {
    const { shortId } = req.body as { shortId: string };
    if (!shortId) {
      res.status(400).json({ success: false, error: 'shortId is required' });
      return;
    }
    const ip = resolveClientIp(req);
    const userAgent = req.headers['user-agent'];
    const deviceFingerprint = (req.body as { deviceFingerprint?: string }).deviceFingerprint;
    try {
      const result = await authService.loginWithId(shortId);
      void notifyLoginSuccess({
        userId: result.user.id,
        ip,
        userAgent,
        deviceFingerprint,
      });
      res.json({ success: true, data: result });
    } catch {
      const user = await prisma.user.findUnique({
        where: { shortId: shortId.toUpperCase().trim() },
        select: { id: true },
      }).catch(() => null);
      if (user?.id) {
        void notifyLoginFailed({ userId: user.id, shortId, ip, userAgent, reason: 'Invalid User ID' });
      }
      res.status(401).json({ success: false, error: 'Invalid User ID. Please check and try again.' });
    }
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
      if (!organizationName?.trim() || !industry || !organizationSize || !workspaceName?.trim()) {
        res.status(400).json({
          success: false,
          error: 'organizationName, industry, organizationSize, and workspaceName are required',
        });
        return;
      }
      const { businessSetupService } = await import('../../services/organization/business-setup.service');
      const result = await businessSetupService.completeSetup(userId, {
        organizationName,
        industry: industry as import('../../services/organization/constants/organization-profile').OrganizationIndustry,
        organizationSize: organizationSize as import('../../services/organization/constants/organization-profile').OrganizationSize,
        workspaceName,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async businessSetupStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const { businessSetupService } = await import('../../services/organization/business-setup.service');
      const status = await businessSetupService.getSetupStatus(userId);
      res.json({ success: true, ...status });
    } catch (err) {
      next(err);
    }
  },
};
