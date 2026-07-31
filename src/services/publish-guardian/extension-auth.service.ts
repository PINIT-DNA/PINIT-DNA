/**
 * Extension OAuth — short-lived codes exchanged for Hub JWT tokens.
 * Additive; does not change existing password/biometric auth.
 */

import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../api/middleware/error.middleware';
import { authService } from '../auth/auth.service';

const CODE_TTL_MS = 5 * 60 * 1000;

export class ExtensionAuthService {
  async issueCode(ownerUserId: string, extensionId: string): Promise<{ code: string; expiresAt: string }> {
    if (!extensionId?.trim()) throw new AppError(400, 'extensionId is required');
    const code = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await prisma.extensionAuthCode.create({
      data: { code, ownerUserId, extensionId: extensionId.trim(), expiresAt },
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async exchangeCode(params: {
    code: string;
    extensionId: string;
  }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { id: string; shortId: string; fullName: string; email: string | null };
  }> {
    const code = String(params.code || '').trim();
    const extensionId = String(params.extensionId || '').trim();
    if (!code || !extensionId) throw new AppError(400, 'code and extensionId are required');

    const row = await prisma.extensionAuthCode.findUnique({ where: { code } });
    if (!row) {
      throw new AppError(401, 'Auth code not found — click Authorize again and paste the new code');
    }
    if (row.usedAt) {
      throw new AppError(401, 'Auth code already used — click Authorize again for a fresh code');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new AppError(401, 'Auth code expired (5 min) — click Authorize again');
    }
    if (row.extensionId !== extensionId) {
      throw new AppError(
        401,
        `Extension ID mismatch — open Sign in from the extension popup (expected ${row.extensionId.slice(0, 8)}…)`,
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: row.ownerUserId },
      select: { id: true, shortId: true, fullName: true, email: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) throw new AppError(401, 'User not found or inactive');

    const tokens = await authService.issueSessionTokens({
      id: user.id,
      shortId: user.shortId,
      fullName: user.fullName,
      role: user.role,
    });

    // Mark used only after tokens succeed so a transient failure can retry the same code
    await prisma.extensionAuthCode.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: 3600,
      user: {
        id: user.id,
        shortId: user.shortId,
        fullName: user.fullName,
        email: user.email,
      },
    };
  }
}

export const extensionAuthService = new ExtensionAuthService();
