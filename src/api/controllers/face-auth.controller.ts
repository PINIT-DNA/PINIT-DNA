/**
 * PINIT-DNA — Enterprise Biometric Authentication Controller
 *
 * Thin HTTP layer — UI contract unchanged:
 *   POST /api/v1/auth/face/register
 *   POST /api/v1/auth/face/login
 *   GET  /api/v1/auth/face/status
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { resolveClientIp } from '../../lib/request-utils';
import { biometricAuthService } from '../../services/auth/biometric-auth.service';

function clientMeta(req: Request) {
  return {
    ip: resolveClientIp(req),
    userAgent: req.headers['user-agent'] ?? '',
  };
}

export async function faceRegister(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { embedding, voiceFingerprint, webauthnCredentialId, deviceFingerprint } = req.body as {
      embedding?: number[];
      voiceFingerprint?: number[];
      webauthnCredentialId?: string;
      deviceFingerprint?: string;
    };

    const meta = clientMeta(req);
    const result = await biometricAuthService.register({
      faceEmbedding: embedding ?? [],
      voiceFingerprint,
      webauthnCredentialId,
      deviceFingerprint,
      ...meta,
    });

    if (!result.ok) {
      res.status(result.status).json({
        success: false,
        message: result.message,
        shortId: result.shortId,
      });
      return;
    }

    res.status(201).json({
      success: true,
      message: 'Face registered successfully',
      user: {
        id: result.user.id,
        shortId: result.user.shortId,
        fullName: result.user.fullName,
        authMethod: 'biometric',
      },
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

export async function faceLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { embedding, voiceFingerprint, webauthnCredentialId, deviceFingerprint } = req.body as {
      embedding?: number[];
      voiceFingerprint?: number[];
      webauthnCredentialId?: string;
      deviceFingerprint?: string;
    };

    const meta = clientMeta(req);
    const result = await biometricAuthService.login({
      faceEmbedding: embedding ?? [],
      voiceFingerprint,
      webauthnCredentialId,
      deviceFingerprint,
      ...meta,
    });

    if (!result.ok) {
      res.status(200).json({
        success: false,
        matched: false,
        message: result.message,
        distance: result.distance ?? null,
      });
      return;
    }

    res.status(200).json({
      success: true,
      matched: true,
      confidence: result.confidence,
      user: {
        id: result.user.id,
        shortId: result.user.shortId,
        fullName: result.user.fullName,
        email: result.user.email,
        role: result.user.role,
      },
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

export async function faceStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = (req as { user?: { sub?: string } }).user?.sub;
    if (!userId) return next(new AppError(401, 'Not authenticated'));

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        faceRegistered: true,
        faceRegisteredAt: true,
        voiceRegistered: true,
        authMethod: true,
        biometricIdentity: { select: { status: true, enrolledAt: true, lastVerifiedAt: true } },
      },
    });

    res.json({
      faceRegistered: user?.faceRegistered ?? false,
      faceRegisteredAt: user?.faceRegisteredAt,
      voiceRegistered: user?.voiceRegistered ?? false,
      authMethod: user?.authMethod ?? 'password',
      biometricIdentity: user?.biometricIdentity ?? null,
    });
  } catch (err) {
    next(err);
  }
}
