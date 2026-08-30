/**
 * PinitHUB Master Admin bridge — same split as Exchange, one extra step.
 *
 * The admin app is a separate Vite project on its own origin/port, so it can't
 * read the Hub SPA's localStorage session. Hub has no password login either,
 * so the admin app cannot host its own sign-in form. Instead: an already-
 * logged-in Hub user requests a short-lived signed bridge token and is
 * redirected into the admin app with it; the admin app immediately exchanges
 * that token for a real Hub session JWT (same shape, same secret, same
 * requireAuth/requireCapability middleware — nothing downstream is special-cased).
 */
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';

const BRIDGE_EXPIRES = '3m';
const SESSION_EXPIRES = '7d';

type AdminBridgePayload = {
  purpose: 'admin_sso';
  sub: string;
  shortId: string;
  name: string;
  role: string;
};

function signSessionToken(payload: { sub: string; shortId: string; name: string; role: string }): string {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: SESSION_EXPIRES });
}

export const adminBridgeService = {
  async createBridgeToken(ownerUserId: string) {
    const user = await prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { id: true, shortId: true, fullName: true, role: true, isActive: true },
    });
    if (!user?.isActive) throw new AppError(404, 'User not found');

    const payload: AdminBridgePayload = {
      purpose: 'admin_sso',
      sub: user.id,
      shortId: user.shortId,
      name: user.fullName,
      role: user.role,
    };
    const token = jwt.sign(payload, config.admin.bridgeSecret, { expiresIn: BRIDGE_EXPIRES });

    return {
      token,
      expiresIn: BRIDGE_EXPIRES,
      adminUrl: `${config.admin.appUrl}/sso?token=${encodeURIComponent(token)}`,
    };
  },

  /** Admin app calls this immediately on load with the bridge token from the URL. */
  async exchangeBridgeToken(token: string) {
    let decoded: AdminBridgePayload;
    try {
      decoded = jwt.verify(token, config.admin.bridgeSecret) as AdminBridgePayload;
    } catch {
      throw new AppError(401, 'Invalid or expired admin bridge token');
    }
    if (decoded.purpose !== 'admin_sso') {
      throw new AppError(401, 'Invalid bridge token purpose');
    }

    // Re-read the user rather than trust the bridge payload's role — the bridge
    // token is only ~3 minutes old in practice, but a role change in that window
    // (or a deactivated account) must take effect immediately, not after expiry.
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, shortId: true, fullName: true, role: true, isActive: true },
    });
    if (!user?.isActive) throw new AppError(401, 'Account no longer active');

    const accessToken = signSessionToken({
      sub: user.id,
      shortId: user.shortId,
      name: user.fullName,
      role: user.role,
    });

    return { accessToken, shortId: user.shortId, role: user.role };
  },
};
