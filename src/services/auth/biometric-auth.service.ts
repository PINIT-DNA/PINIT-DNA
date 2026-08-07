/**
 * Enterprise Biometric Authentication Engine
 *
 * - Encrypted templates (face / voice / fingerprint)
 * - Global duplicate prevention (one identity per person)
 * - Multi-modal fusion scoring
 * - Multi-device support (same user, many devices)
 * - JWT + session + audit trail
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { config } from '../../config';
import { AppError } from '../../api/middleware/error.middleware';
import {
  encryptTemplate,
  decryptTemplate,
  hashSessionToken,
} from './biometric-crypto.service';
import {
  THRESHOLDS,
  normalizeEmbedding,
  euclideanDistance,
  deriveFingerprintTemplate,
  fuseBiometricScores,
  isValidTemplate,
  rankFaceMatches,
  isConfidentFaceMatch,
  type FusionResult,
} from './biometric-matching.service';
import { logSecurityEvent, logLoginHistory } from './biometric-audit.service';

const JWT_SECRET = config.jwt.secret;

export interface BiometricRegisterInput {
  faceEmbedding: number[];
  voiceFingerprint?: number[];
  webauthnCredentialId?: string;
  deviceFingerprint?: string;
  accountType?: 'INDIVIDUAL' | 'BUSINESS';
  organizationName?: string;
  ip?: string;
  userAgent?: string;
}

export interface BiometricLoginInput {
  faceEmbedding: number[];
  voiceFingerprint?: number[];
  webauthnCredentialId?: string;
  deviceFingerprint?: string;
  ip?: string;
  userAgent?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  shortId: string;
  fullName: string;
  email: string | null;
  role: string;
}

function generateShortId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) id += chars[bytes[i]! % chars.length];
  return `PINIT-${id}`;
}

function createTokens(user: {
  id: string;
  shortId: string;
  fullName: string;
  role: string;
  accountType?: string;
}): AuthTokens {
  const accessToken = jwt.sign(
    {
      sub: user.id,
      shortId: user.shortId,
      name: user.fullName,
      role: user.role,
      accountType: user.accountType ?? 'INDIVIDUAL',
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
  const refreshToken = jwt.sign({ sub: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}

async function loadAllFaceTemplates(opts?: {
  activeOnly?: boolean;
}): Promise<Array<{ userId: string; shortId: string; embedding: number[]; source: string }>> {
  const users = await prisma.user.findMany({
    where: {
      faceRegistered: true,
      ...(opts?.activeOnly ? { isActive: true } : {}),
    },
    select: {
      id: true,
      shortId: true,
      faceEmbedding: true,
      biometricIdentity: { include: { faceTemplate: true } },
    },
  });

  const results: Array<{ userId: string; shortId: string; embedding: number[]; source: string }> = [];

  for (const u of users) {
    let embedding: number[] | null = null;
    let source = 'none';

    if (u.biometricIdentity?.faceTemplate) {
      try {
        embedding = normalizeEmbedding(decryptTemplate(u.biometricIdentity.faceTemplate.templateCipher));
        source = 'enterprise_cipher';
      } catch (err) {
        logger.warn('[Auth] Face cipher decrypt failed — falling back to user.faceEmbedding', {
          userId: u.id,
          shortId: u.shortId,
          error: String(err),
        });
      }
    }

    if (!embedding && u.faceEmbedding.length === 128) {
      embedding = normalizeEmbedding(u.faceEmbedding);
      source = u.biometricIdentity?.faceTemplate ? 'user_fallback' : 'user_plain';
    }

    if (embedding) {
      results.push({ userId: u.id, shortId: u.shortId, embedding, source });
    } else {
      logger.warn('[Auth] Registered user has no usable face template', {
        userId: u.id,
        shortId: u.shortId,
        embeddingLen: u.faceEmbedding.length,
      });
    }
  }

  logger.info('[Auth] Face template registry loaded', {
    registeredUsers: users.length,
    searchableTemplates: results.length,
    activeOnly: Boolean(opts?.activeOnly),
  });

  return results;
}

/**
 * Face is the only uniqueness gate for registration.
 * Device fingerprint / WebAuthn MUST NOT block new people on a shared browser —
 * that caused "No identity found" on login then "already registered" on register.
 */
async function findMatchingFace(
  face: number[],
): Promise<{ userId: string; shortId: string; distance: number } | null> {
  const faceNorm = normalizeEmbedding(face);
  const faceDupThreshold = Math.max(THRESHOLDS.faceDuplicate, THRESHOLDS.faceLogin);
  const faces = await loadAllFaceTemplates();
  const { best, secondDistance } = rankFaceMatches(faceNorm, faces);

  if (!best) {
    logger.info('[Auth:Register] Face uniqueness check — empty registry');
    return null;
  }

  logger.info('[Auth:Register] Face uniqueness check', {
    nearestShortId: best.shortId,
    nearestDistance: Number(best.distance.toFixed(4)),
    secondDistance: Number.isFinite(secondDistance) ? Number(secondDistance.toFixed(4)) : null,
    threshold: faceDupThreshold,
    compared: faces.length,
  });

  if (!isConfidentFaceMatch(best.distance, secondDistance)) {
    return null;
  }

  return { userId: best.userId, shortId: best.shortId, distance: best.distance };
}

async function issueSessionForUser(
  user: { id: string; shortId: string; fullName: string; email: string | null; role: string; accountType?: string | null },
  opts: {
    webauthnCredentialId?: string;
    deviceFingerprint?: string;
    ip?: string;
    userAgent?: string;
    event: 'REGISTRATION' | 'BIOMETRIC_MATCH' | 'ACCOUNT_TYPE_LINK';
  },
): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const deviceId = await upsertDevice(user.id, opts.deviceFingerprint, opts.webauthnCredentialId);
  const tokens = createTokens({
    id: user.id,
    shortId: user.shortId,
    fullName: user.fullName,
    role: user.role,
    accountType: user.accountType ?? 'INDIVIDUAL',
  });
  await createSession(user.id, tokens.refreshToken, opts.ip, opts.userAgent, deviceId);
  await logSecurityEvent(opts.event, {
    userId: user.id,
    ip: opts.ip,
    userAgent: opts.userAgent,
    deviceId,
    detail: { shortId: user.shortId },
  });
  await logLoginHistory({
    userId: user.id,
    method: opts.event === 'REGISTRATION' ? 'biometric_register' : 'biometric_login',
    ip: opts.ip,
    userAgent: opts.userAgent,
    success: true,
  });
  return {
    user: {
      id: user.id,
      shortId: user.shortId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
    },
    tokens,
  };
}

async function loadVoiceForUser(userId: string): Promise<number[] | null> {
  const identity = await prisma.biometricIdentity.findUnique({
    where: { userId },
    include: { voiceTemplate: true },
  });
  if (identity?.voiceTemplate) {
    try {
      return normalizeEmbedding(decryptTemplate(identity.voiceTemplate.templateCipher));
    } catch (err) {
      logger.warn('[Auth] Voice cipher decrypt failed — using user.voiceEmbedding', { userId, error: String(err) });
    }
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { voiceEmbedding: true, voiceRegistered: true },
  });
  if (user?.voiceRegistered && user.voiceEmbedding.length === 128) {
    return normalizeEmbedding(user.voiceEmbedding);
  }
  return null;
}

async function loadFingerprintForUser(userId: string): Promise<number[] | null> {
  const identity = await prisma.biometricIdentity.findUnique({
    where: { userId },
    include: { fingerprintTemplate: true },
  });
  if (identity?.fingerprintTemplate) {
    try {
      return normalizeEmbedding(decryptTemplate(identity.fingerprintTemplate.templateCipher));
    } catch (err) {
      logger.warn('[Auth] Fingerprint cipher decrypt failed', { userId, error: String(err) });
    }
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { webauthnCredentialId: true, deviceFingerprint: true },
  });
  if (user?.webauthnCredentialId || user?.deviceFingerprint) {
    return deriveFingerprintTemplate(user.webauthnCredentialId, user.deviceFingerprint);
  }
  return null;
}

async function upsertDevice(userId: string, deviceFingerprint?: string, webauthnCredentialId?: string): Promise<string | undefined> {
  if (!deviceFingerprint) return undefined;
  const device = await prisma.userDevice.upsert({
    where: { userId_deviceFingerprint: { userId, deviceFingerprint } },
    create: {
      userId,
      deviceFingerprint,
      webauthnCredentialId: webauthnCredentialId ?? null,
      lastSeenAt: new Date(),
    },
    update: {
      webauthnCredentialId: webauthnCredentialId ?? undefined,
      lastSeenAt: new Date(),
    },
  });
  return device.id;
}

async function createSession(userId: string, refreshToken: string, ip?: string, userAgent?: string, deviceId?: string): Promise<void> {
  try {
    await prisma.userSession.create({
      data: {
        userId,
        sessionHash: hashSessionToken(refreshToken),
        deviceId: deviceId ?? null,
        ip: ip ?? null,
        userAgent: userAgent ?? null,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  } catch (e) {
    logger.warn('user_sessions table unavailable', { error: String(e) });
  }
  await prisma.refreshToken.create({
    data: {
      userId,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

export const biometricAuthService = {
  async register(input: BiometricRegisterInput): Promise<
    | { ok: true; user: AuthUser; tokens: AuthTokens; linked?: boolean; message?: string }
    | { ok: false; status: 409; message: string; shortId?: string }
  > {
    const {
      faceEmbedding,
      voiceFingerprint,
      webauthnCredentialId,
      deviceFingerprint,
      accountType,
      organizationName,
      ip,
      userAgent,
    } = input;

    const resolvedAccountType = accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';

    if (!isValidTemplate(faceEmbedding)) {
      throw new AppError(400, 'Invalid face embedding. Must be 128-dimensional float array.');
    }

    if (!voiceFingerprint || !isValidTemplate(voiceFingerprint)) {
      throw new AppError(
        400,
        'Voice fingerprint is required and must be 128 finite numbers. Complete voice verification before registering.',
      );
    }

    const faceNorm = normalizeEmbedding(faceEmbedding);
    const voiceNorm = normalizeEmbedding(voiceFingerprint);
    const fpNorm = deriveFingerprintTemplate(webauthnCredentialId, deviceFingerprint);

    // Same face → same PINIT ID. Individual + Business share that ID (mode only differs).
    const existingFace = await findMatchingFace(faceNorm);
    if (existingFace) {
      const existing = await prisma.user.findUnique({
        where: { id: existingFace.userId },
        select: {
          id: true,
          shortId: true,
          fullName: true,
          email: true,
          role: true,
          accountType: true,
          isActive: true,
        },
      });

      if (!existing || !existing.isActive) {
        await logSecurityEvent('DUPLICATE_REGISTRATION', {
          ip, userAgent, success: false,
          detail: {
            modality: 'face',
            existingShortId: existingFace.shortId,
            distance: existingFace.distance,
            inactive: true,
          },
        });
        return {
          ok: false,
          status: 409,
          message: `This face is linked to ${existingFace.shortId}, but that account is inactive. Contact support to recover access.`,
          shortId: existingFace.shortId,
        };
      }

      let working = existing;
      // Enable Business on the same ShortId when the person enrolls for Business later (or vice versa stays on same ID).
      if (resolvedAccountType === 'BUSINESS' && existing.accountType !== 'BUSINESS') {
        const upgraded = await this.updateAccountType(existing.id, 'BUSINESS', organizationName);
        working = {
          ...existing,
          accountType: upgraded.accountType,
        };
        logger.info('[Auth:Register] Linked Business mode to existing face identity', {
          shortId: existing.shortId,
          distance: Number(existingFace.distance.toFixed(4)),
        });
      } else {
        logger.info('[Auth:Register] Face already enrolled — signing into existing PINIT ID', {
          shortId: existing.shortId,
          requestedType: resolvedAccountType,
          storedType: existing.accountType,
          distance: Number(existingFace.distance.toFixed(4)),
        });
      }

      const session = await issueSessionForUser(working, {
        webauthnCredentialId,
        deviceFingerprint,
        ip,
        userAgent,
        event: 'ACCOUNT_TYPE_LINK',
      });

      return {
        ok: true,
        ...session,
        linked: true,
        message:
          resolvedAccountType === 'BUSINESS'
            ? `Welcome back — Business mode is ready on ${working.shortId} (same face identity).`
            : `Welcome back — signed in as ${working.shortId}. Use Individual / Business switch when both modes are enabled.`,
      };
    }

    const faceEnc = encryptTemplate(faceNorm);
    const voiceEnc = voiceNorm ? encryptTemplate(voiceNorm) : null;
    const fpEnc = encryptTemplate(fpNorm);
    const identityHash = crypto.createHash('sha256')
      .update(`${faceEnc.hash}:${voiceEnc?.hash ?? 'none'}:${fpEnc.hash}`)
      .digest('hex');

    logger.info('[Auth:Register] ✓ Face template generated', { dimensions: faceNorm.length });
    logger.info('[Auth:Register] ✓ Fingerprint template generated', { dimensions: fpNorm.length, hasWebAuthn: Boolean(webauthnCredentialId) });
    if (voiceNorm) {
      logger.info('[Auth:Register] ✓ Voice template generated', { dimensions: voiceNorm.length });
    }

    const shortId = generateShortId();

    let user: { id: string; shortId: string; fullName: string; email: string | null; role: string };
    let usedEnterpriseTables = true;
    try {
      user = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            shortId,
            fullName: 'PINIT User',
            accountType: resolvedAccountType,
            organization: resolvedAccountType === 'BUSINESS' && organizationName?.trim()
              ? organizationName.trim()
              : null,
            faceEmbedding: faceNorm,
            faceRegistered: true,
            faceRegisteredAt: new Date(),
            voiceEmbedding: voiceNorm ?? [],
            voiceRegistered: Boolean(voiceNorm),
            webauthnCredentialId: webauthnCredentialId ?? null,
            deviceFingerprint: deviceFingerprint ?? null,
            authMethod: 'biometric',
            role: 'USER',
          },
        });

        const identity = await tx.biometricIdentity.create({
          data: { userId: u.id, identityHash, status: 'ACTIVE' },
        });

        await tx.faceTemplate.create({
          data: {
            biometricIdentityId: identity.id,
            templateCipher: faceEnc.cipher,
            templateHash: faceEnc.hash,
          },
        });

        if (voiceEnc) {
          await tx.voiceTemplate.create({
            data: {
              biometricIdentityId: identity.id,
              templateCipher: voiceEnc.cipher,
              templateHash: voiceEnc.hash,
            },
          });
        }

        await tx.fingerprintTemplate.create({
          data: {
            biometricIdentityId: identity.id,
            templateCipher: fpEnc.cipher,
            templateHash: fpEnc.hash,
            credentialId: webauthnCredentialId ?? null,
          },
        });

        return u;
      });
    } catch (e) {
      usedEnterpriseTables = false;
      logger.warn('[Auth:Register] Enterprise tables unavailable — legacy user registration', { error: String(e) });
      user = await prisma.user.create({
        data: {
          shortId,
          fullName: 'PINIT User',
          accountType: resolvedAccountType,
          organization: resolvedAccountType === 'BUSINESS' && organizationName?.trim()
            ? organizationName.trim()
            : null,
          faceEmbedding: faceNorm,
          faceRegistered: true,
          faceRegisteredAt: new Date(),
          voiceEmbedding: voiceNorm ?? [],
          voiceRegistered: Boolean(voiceNorm),
          webauthnCredentialId: webauthnCredentialId ?? null,
          deviceFingerprint: deviceFingerprint ?? null,
          authMethod: 'biometric',
          role: 'USER',
        },
      });
    }

    logger.info('[Auth:Register] ✓ User created', { userId: user.id, shortId: user.shortId, pinitId: user.shortId });

    try {
      const { subscriptionService } = await import('../subscription');
      await subscriptionService.ensureDefaultSubscription(user.id);
    } catch (subErr) {
      logger.warn('[Auth:Register] Subscription backfill skipped (non-fatal)', { error: String(subErr) });
    }

    if (resolvedAccountType === 'BUSINESS') {
      try {
        const { organizationService } = await import('../organization/organization.service');
        await organizationService.ensureForOwner(user.id);
      } catch (orgErr) {
        logger.warn('[Auth:Register] Org bootstrap skipped (non-fatal)', { error: String(orgErr) });
      }
    }

    const session = await issueSessionForUser(
      { ...user, accountType: resolvedAccountType },
      {
        webauthnCredentialId,
        deviceFingerprint,
        ip,
        userAgent,
        event: 'REGISTRATION',
      },
    );

    logger.info('[Auth:Register] Pipeline complete', {
      userId: user.id,
      pinitId: user.shortId,
      accountType: resolvedAccountType,
      enterpriseTables: usedEnterpriseTables,
    });

    return { ok: true, ...session };
  },

  async login(input: BiometricLoginInput): Promise<
    | { ok: true; user: AuthUser; tokens: AuthTokens; confidence: number; fusion: FusionResult }
    | { ok: false; matched: false; message: string; distance?: string }
  > {
    const { faceEmbedding, voiceFingerprint, webauthnCredentialId, deviceFingerprint, ip, userAgent } = input;

    if (!isValidTemplate(faceEmbedding)) {
      throw new Error('Invalid face embedding. Must be 128-dimensional float array.');
    }

    const faceNorm = normalizeEmbedding(faceEmbedding);
    const probeVoice = voiceFingerprint && isValidTemplate(voiceFingerprint)
      ? normalizeEmbedding(voiceFingerprint)
      : null;
    const probeFp = deriveFingerprintTemplate(webauthnCredentialId, deviceFingerprint);

    logger.info('[Auth:Login] ✓ Face template generated', { dimensions: faceNorm.length });
    logger.info('[Auth:Login] ✓ Fingerprint template generated', {
      dimensions: probeFp.length,
      hasWebAuthn: Boolean(webauthnCredentialId),
      deviceBound: Boolean(deviceFingerprint),
    });
    if (probeVoice) {
      logger.info('[Auth:Login] ✓ Voice template generated', { dimensions: probeVoice.length });
    } else {
      logger.info('[Auth:Login] ○ Voice template not provided or invalid');
    }

    const candidates = await loadAllFaceTemplates({ activeOnly: true });
    const ranked = rankFaceMatches(faceNorm, candidates);
    const best = ranked.best;
    const bestFaceDist = best?.distance ?? Infinity;
    const bestUserId = best?.userId ?? null;
    const bestShortId = best?.shortId ?? '';
    const bestSource = best?.source ?? '';
    const secondFaceDistance = ranked.secondDistance;

    logger.info('[Auth:Login] Matching score', {
      candidateCount: candidates.length,
      bestCandidate: bestShortId || null,
      bestDistance: bestFaceDist === Infinity ? null : Number(bestFaceDist.toFixed(4)),
      secondDistance: Number.isFinite(secondFaceDistance) ? Number(secondFaceDistance.toFixed(4)) : null,
      threshold: THRESHOLDS.faceLogin,
      margin: THRESHOLDS.faceLoginMargin,
      templateSource: bestSource || null,
    });

    if (!bestUserId || !isConfidentFaceMatch(bestFaceDist, secondFaceDistance)) {
      logger.warn('[Auth:Login] ✗ Authentication result: NO_MATCH', {
        reason: candidates.length === 0
          ? 'empty_registry'
          : bestFaceDist >= THRESHOLDS.faceLogin
            ? 'face_distance_above_threshold'
            : 'face_margin_insufficient',
        bestDistance: bestFaceDist === Infinity ? null : bestFaceDist.toFixed(4),
        secondDistance: Number.isFinite(secondFaceDistance) ? secondFaceDistance.toFixed(4) : null,
        threshold: THRESHOLDS.faceLogin,
      });
      await logSecurityEvent('BIOMETRIC_FAILURE', {
        ip, userAgent, success: false,
        detail: {
          reason: 'no_face_match',
          distance: bestFaceDist,
          secondDistance: secondFaceDistance,
          candidateCount: candidates.length,
        },
      });
      return {
        ok: false,
        matched: false,
        message: 'No identity found. Please register.',
        distance: bestFaceDist === Infinity ? undefined : bestFaceDist.toFixed(4),
      };
    }

    const storedVoice = await loadVoiceForUser(bestUserId);
    const storedFp = await loadFingerprintForUser(bestUserId);

    const voiceDist = storedVoice && probeVoice
      ? euclideanDistance(probeVoice, storedVoice)
      : null;
    const fpDist = storedFp
      ? euclideanDistance(probeFp, storedFp)
      : null;

    const fusion = fuseBiometricScores(
      bestFaceDist,
      voiceDist,
      fpDist,
      {
        hasVoice: Boolean(storedVoice && probeVoice),
        hasFingerprint: Boolean(storedFp),
        secondFaceDistance,
      },
    );

    logger.info('[Auth:Login] Fusion scores', {
      faceDistance: fusion.scores.faceDistance,
      faceConfidence: fusion.scores.face,
      voiceDistance: voiceDist,
      voiceConfidence: fusion.scores.voice,
      fingerprintDistance: fpDist,
      fingerprintConfidence: fusion.scores.fingerprint,
      overallConfidence: fusion.overallConfidence,
      verified: fusion.verified,
    });

    if (!fusion.verified) {
      logger.warn('[Auth:Login] ✗ Authentication result: FUSION_REJECTED', {
        bestCandidate: bestShortId,
        faceDistance: bestFaceDist.toFixed(4),
        threshold: THRESHOLDS.faceLogin,
      });
      await logLoginHistory({
        userId: bestUserId,
        method: 'biometric_login',
        ip, userAgent,
        success: false,
        failReason: `Fusion confidence ${fusion.overallConfidence}% below threshold`,
      });
      return {
        ok: false,
        matched: false,
        message: 'No identity found. Please register.',
        distance: bestFaceDist.toFixed(4),
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: bestUserId, isActive: true },
      select: { id: true, shortId: true, fullName: true, email: true, role: true, accountType: true },
    });

    if (!user) {
      return { ok: false, matched: false, message: 'No identity found. Please register.' };
    }

    const deviceId = await upsertDevice(user.id, deviceFingerprint, webauthnCredentialId);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await prisma.biometricIdentity.updateMany({
      where: { userId: user.id },
      data: { lastVerifiedAt: new Date() },
    });

    const tokens = createTokens({
      id: user.id,
      shortId: user.shortId,
      fullName: user.fullName,
      role: user.role,
      accountType: user.accountType ?? 'INDIVIDUAL',
    });
    await createSession(user.id, tokens.refreshToken, ip, userAgent, deviceId);

    await logSecurityEvent('BIOMETRIC_MATCH', {
      userId: user.id, ip, userAgent, deviceId,
      detail: { confidence: fusion.overallConfidence, scores: fusion.scores },
    });
    await logLoginHistory({ userId: user.id, method: 'biometric_login', ip, userAgent, success: true });

    logger.info('[Auth:Login] ✓ Authentication result: SUCCESS', {
      userId: user.id,
      pinitId: user.shortId,
      confidence: fusion.overallConfidence,
      faceDistance: bestFaceDist.toFixed(4),
    });

    logger.info('Enterprise biometric login success', {
      shortId: user.shortId,
      confidence: fusion.overallConfidence,
    });

    return {
      ok: true,
      user,
      tokens,
      confidence: fusion.overallConfidence,
      fusion,
    };
  },

  async updateAccountType(
    userId: string,
    accountType: 'INDIVIDUAL' | 'BUSINESS',
    organizationName?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    accountType: 'INDIVIDUAL' | 'BUSINESS';
    planAdjusted?: boolean;
    planCode?: import('../subscription/constants/plans').PlanCode;
  }> {
    const resolved = accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';

    const sub = await prisma.subscription.findUnique({
      where: { userId },
      include: { plan: true },
    });
    const currentPlanCode = (sub?.plan.code ?? 'FREE') as import('../subscription/constants/plans').PlanCode;
    const { planAfterAccountTypeChange } = await import('../account/account-subscription-rules');
    const nextPlanCode = planAfterAccountTypeChange(resolved, currentPlanCode);
    const planAdjusted = nextPlanCode !== currentPlanCode;

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        accountType: resolved,
        ...(resolved === 'INDIVIDUAL'
          ? {
              organization: null,
              organizationIndustry: null,
              organizationSize: null,
              workspaceName: null,
              businessSetupCompletedAt: null,
            }
          : {
              organization: organizationName?.trim() || null,
              organizationIndustry: null,
              organizationSize: null,
              workspaceName: null,
              businessSetupCompletedAt: null,
            }),
      },
      select: { id: true, shortId: true, fullName: true, role: true, accountType: true },
    });

    if (planAdjusted) {
      const { subscriptionService } = await import('../subscription/subscription.service');
      await subscriptionService.assignPlan(userId, nextPlanCode);
    }

    if (resolved === 'BUSINESS') {
      const { organizationService } = await import('../organization/organization.service');
      await organizationService.ensureForOwner(userId);
    }

    const tokens = createTokens({
      id: user.id,
      shortId: user.shortId,
      fullName: user.fullName,
      role: user.role,
      accountType: user.accountType ?? resolved,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accountType: resolved,
      planAdjusted,
      planCode: nextPlanCode,
    };
  },
};
