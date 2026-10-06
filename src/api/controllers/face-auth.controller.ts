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
import { logger } from '../../lib/logger';

function clientMeta(req: Request) {
  return {
    ip: resolveClientIp(req),
    userAgent: req.headers['user-agent'] ?? '',
  };
}

export async function faceBeginEnrollment(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const claim = await biometricAuthService.beginEnrollment();
    res.status(201).json({ success: true, shortId: claim.shortId, enrollmentToken: claim.enrollmentToken });
  } catch (err) {
    next(err);
  }
}

export async function faceReenroll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = (req as { user?: { sub?: string } }).user?.sub;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Sign in again before updating your face.' });
      return;
    }
    const { embedding, padEvidence } = req.body as { embedding?: number[]; padEvidence?: PadEvidence };
    const result = await biometricAuthService.reenrollFace({
      userId,
      faceEmbedding: embedding ?? [],
      padEvidence,
      ...clientMeta(req),
    });
    if (!result.ok) {
      res.status(result.status).json({ success: false, message: result.message });
      return;
    }
    res.json({ success: true, message: 'Face updated for this account.' });
  } catch (err) {
    next(err);
  }
}

export async function faceRegister(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const {
      embedding, samples, enrollmentToken, voiceFingerprint, webauthnCredentialId, deviceFingerprint,
      accountType, organizationName, padEvidence, passkeyPendingToken,
    } = req.body as {
      embedding?: number[];
      samples?: Array<{ embedding?: number[]; padEvidence?: PadEvidence }>;
      enrollmentToken?: string;
      voiceFingerprint?: number[];
      webauthnCredentialId?: string;
      deviceFingerprint?: string;
      accountType?: 'INDIVIDUAL' | 'BUSINESS';
      organizationName?: string;
      padEvidence?: PadEvidence;
      passkeyPendingToken?: string;
    };

    const meta = clientMeta(req);
    const faceSamples = (samples ?? [])
      .filter((sample) => Array.isArray(sample.embedding))
      .map((sample) => ({ embedding: sample.embedding as number[], padEvidence: sample.padEvidence }));
    const result = await biometricAuthService.register({
      faceEmbedding: embedding ?? faceSamples[0]?.embedding ?? [],
      faceSamples,
      enrollmentToken,
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
  const handlerStart = performance.now();
  try {
    const {
      embedding, voiceFingerprint, webauthnCredentialId, deviceFingerprint,
      claimedShortId, claimedUserId, pinitId, shortId, padEvidence,
      webauthnSession, passkeyPendingToken, lightingTelemetry,
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
      lightingTelemetry?: { ambientBrightness?: number; lightingStatus?: string };
    };

    const patches = padEvidence?.patches;
    let bodyKb = 0;
    try {
      bodyKb = JSON.stringify(req.body).length / 1024;
    } catch { /* ignore */ }
    logger.info('[Auth:Perf] Incoming Face Login payload size', {
      kb: Number(bodyKb.toFixed(2)),
      embeddingLen: Array.isArray(embedding) ? embedding.length : 0,
      patchCount: Array.isArray(patches) ? patches.length : 0,
    });

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
      lightingTelemetry,
      ...meta,
    });

    const perf = 'perf' in result ? result.perf : undefined;
    logger.info('[Auth:Perf] handler', {
      totalMs: Number((performance.now() - handlerStart).toFixed(2)),
      ok: result.ok,
      padMs: perf?.padMs,
      claimMs: perf?.claimMs,
      decryptMs: perf?.decryptMs,
      matchMs: perf?.matchMs,
      jwtMs: perf?.jwtMs,
      engineMs: perf?.totalMs,
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
    logger.error('[Auth:Perf] Failed after', {
      totalMs: Number((performance.now() - handlerStart).toFixed(2)),
    });
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

export async function faceChallenge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const mode = (req.body as { mode?: string } | undefined)?.mode === 'passive' ? 'passive' : 'active';
    const issued = issuePadChallenge(mode);
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
