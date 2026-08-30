/**
 * PinitHUB Master Admin bridge controller.
 * Mint runs under the Hub SPA's normal session; exchange is public (the
 * bridge token itself is the credential — see admin-bridge.service.ts).
 */
import { Request, Response, NextFunction } from 'express';
import { adminBridgeService } from '../../services/auth/admin-bridge.service';
import { config } from '../../config';

function userId(req: Request): string {
  return (req as { user?: { sub?: string } }).user?.sub as string;
}

/** GET /admin-bridge/config — public-safe URL for the Hub UI's launcher link */
export async function getAdminBridgeConfig(_req: Request, res: Response): Promise<void> {
  res.json({ success: true, appUrl: config.admin.appUrl });
}

/** POST /admin-bridge/sso — Hub UI calls this (authenticated) to get a launch URL */
export async function createAdminBridgeToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await adminBridgeService.createBridgeToken(userId(req));
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

/** POST /admin-bridge/exchange — admin app calls this (unauthenticated) with the bridge token */
export async function exchangeAdminBridgeToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) {
      res.status(400).json({ success: false, error: 'Missing bridge token' });
      return;
    }
    const result = await adminBridgeService.exchangeBridgeToken(token);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}
