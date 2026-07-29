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
    const row = await prisma.extensionAuthCode.findUnique({ where: { code: params.code } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw new AppError(401, 'Invalid or expired extension auth code');
    }
    if (row.extensionId !== params.extensionId) {
      throw new AppError(401, 'Extension ID mismatch');
    }

    await prisma.extensionAuthCode.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });

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
