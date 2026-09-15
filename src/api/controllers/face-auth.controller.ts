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
import { issuePadChallenge, type PadEvidence } from '../../services/auth/face-liveness.service';
import { setRefreshCookie } from '../../lib/auth-cookies';

function clientMeta(req: Request) {
  return {
    ip: resolveClientIp(req),
    userAgent: req.headers['user-agent'] ?? '',
  };
}

export async function faceRegister(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      embedding, voiceFingerprint, webauthnCredentialId, deviceFingerprint,
      accountType, organizationName, padEvidence, passkeyPendingToken,
    } = req.body as {
      embedding?: number[];
      voiceFingerprint?: number[];
      webauthnCredentialId?: string;
      deviceFingerprint?: string;
      accountType?: 'INDIVIDUAL' | 'BUSINESS';
      organizationName?: string;
      padEvidence?: PadEvidence;
      passkeyPendingToken?: string;
    };

    const meta = clientMeta(req);
    const result = await biometricAuthService.register({
      faceEmbedding: embedding ?? [],
      padEvidence,
      passkeyPendingToken,
      voiceFingerprint,
      webauthnCredentialId,
      deviceFingerprint,
      accountType,
      organizationName,
      ...meta,
    });

    if (!result.ok) {
      res.status(result.status).json({
        success: false,
        message: result.message,
      });
      return;
    }

    setRefreshCookie(req, res, result.tokens.refreshToken);
    res.status(201).json({
      success: true,
      message: result.message ?? 'Face registered successfully',
      linked: false,
      user: {
        id: result.user.id,
        shortId: result.user.shortId,
        fullName: result.user.fullName,
        authMethod: 'biometric',
      },
      accessToken: result.tokens.accessToken,
    });
  } catch (err) {
    next(err);
  }
}

export async function faceLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      embedding, voiceFingerprint, webauthnCredentialId, deviceFingerprint,
      claimedShortId, claimedUserId, pinitId, shortId, padEvidence,
      webauthnSession, passkeyPendingToken,
    } = req.body as {
      embedding?: number[];
      voiceFingerprint?: number[];
      webauthnCredentialId?: string;
      deviceFingerprint?: string;
      claimedShortId?: string;
      claimedUserId?: string;
      pinitId?: string;
      shortId?: string;
      padEvidence?: PadEvidence;
      webauthnSession?: string;
      passkeyPendingToken?: string;
    };

    const meta = clientMeta(req);
    const result = await biometricAuthService.login({
      faceEmbedding: embedding ?? [],
      padEvidence,
      webauthnSession,
      passkeyPendingToken,
      claimedShortId: (claimedShortId || pinitId || shortId || '').trim() || undefined,
      claimedUserId: claimedUserId?.trim() || undefined,
      voiceFingerprint,
      webauthnCredentialId,
      deviceFingerprint,
      ...meta,
    });

    if (!result.ok) {
      // No similarity distance in the response — it would let an attacker measure
      // how close a probe face is to an enrolled one and iterate toward a match.
      res.status(200).json({
        success: false,
        matched: false,
        message: result.message,
      });
      return;
    }

    setRefreshCookie(req, res, result.tokens.refreshToken);
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
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/face/identify — sign in by face alone, no Pinit ID typed.
 *
 * Mirrors faceLogin's response shape so the client can treat them the same on
 * success. A refusal is always the same opaque body: no distance, no shortId,
 * nothing that reveals whether a face is enrolled.
 */
export async function faceIdentify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { embedding, deviceFingerprint, padEvidence } = req.body as {
      embedding?: number[];
      deviceFingerprint?: string;
      padEvidence?: PadEvidence;
    };

    const meta = clientMeta(req);
    const result = await biometricAuthService.identify({
      faceEmbedding: embedding ?? [],
      padEvidence,
      deviceFingerprint,
      ...meta,
    });

    if (!result.ok) {
      res.status(200).json({
        success: false,
        matched: false,
        message: result.message,
      });
      return;
    }

    setRefreshCookie(req, res, result.tokens.refreshToken);
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

export async function faceChallenge(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const issued = issuePadChallenge();
    res.status(200).json({
      success: true,
      token: issued.token,
      nonce: issued.challenge.nonce,
      actions: issued.challenge.actions,
      expiresAt: issued.challenge.exp,
      instructions: issued.instructions,
    });
  } catch (err) {
    next(err);
  }
}
