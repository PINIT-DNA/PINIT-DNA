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
  isDuplicateFaceEnrollment,
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

async function mintUniqueShortId(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const shortId = generateShortId();
    const exists = await prisma.user.findUnique({ where: { shortId }, select: { id: true } });
    if (!exists) return shortId;
  }
  throw new AppError(500, 'Could not allocate a unique PINIT ID. Try again.');
}

/** Never attach a WebAuthn / device credential that already belongs to another user. */
async function credentialIdOwnedByOtherUser(
  credentialId: string | undefined,
  userId?: string,
): Promise<boolean> {
  if (!credentialId) return false;
  const owner = await prisma.user.findFirst({
    where: {
      webauthnCredentialId: credentialId,
      ...(userId ? { NOT: { id: userId } } : {}),
    },
    select: { id: true },
  });
  if (owner && owner.id !== userId) return true;
  if (!userId && owner) return true;
  return false;
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
 * 1:N enroll search. Face is the only uniqueness gate.
 * A hit means "this person already has an account" — never mint or sign them in here.
 * Device fingerprint / WebAuthn must not decide identity on a shared browser.
 */
async function findMatchingFace(
  face: number[],
): Promise<{ userId: string; shortId: string; distance: number; ambiguous?: boolean } | null> {
  const faceNorm = normalizeEmbedding(face);
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
    threshold: THRESHOLDS.faceDuplicate,
    compared: faces.length,
  });

  if (best.distance >= THRESHOLDS.faceDuplicate) {
    return null;
  }

  if (!isDuplicateFaceEnrollment(best.distance, secondDistance)) {
    return {
      userId: best.userId,
      shortId: best.shortId,
      distance: best.distance,
      ambiguous: true,
    };
  }

  return { userId: best.userId, shortId: best.shortId, distance: best.distance };
}

async function loadFaceTemplateForUser(userId: string): Promise<number[] | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      faceEmbedding: true,
      biometricIdentity: { include: { faceTemplate: true } },
    },
  });
  if (!u) return null;

  if (u.biometricIdentity?.faceTemplate) {
    try {
      return normalizeEmbedding(decryptTemplate(u.biometricIdentity.faceTemplate.templateCipher));
    } catch (err) {
      logger.warn('[Auth] Face cipher decrypt failed for 1:1 verify', { userId, error: String(err) });
    }
  }

  if (u.faceEmbedding.length === 128) {
    return normalizeEmbedding(u.faceEmbedding);
  }
  return null;
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

    const faceNorm = normalizeEmbedding(faceEmbedding);
    const voiceNorm = voiceFingerprint && isValidTemplate(voiceFingerprint)
      ? normalizeEmbedding(voiceFingerprint)
      : null;
    let boundCredentialId = webauthnCredentialId;
    if (await credentialIdOwnedByOtherUser(boundCredentialId)) {
      logger.warn('[Auth:Register] Ignoring WebAuthn credential already bound to another user');
      boundCredentialId = undefined;
    }
    const fpNorm = deriveFingerprintTemplate(boundCredentialId, deviceFingerprint);

    // 1:N duplicate search FIRST. Never create a user, then attach this face.
    const existingFace = await findMatchingFace(faceNorm);
    if (existingFace) {
      await logSecurityEvent('DUPLICATE_REGISTRATION', {
        ip, userAgent, success: false,
        detail: {
          modality: 'face',
          existingShortId: existingFace.shortId,
          distance: existingFace.distance,
          ambiguous: Boolean(existingFace.ambiguous),
        },
      });
      return {
        ok: false,
        status: 409,
        message: existingFace.ambiguous
          ? 'This face is too similar to an existing Pinit HUB account to create a new one. Sign in instead.'
          : `This person already has a Pinit HUB account (${existingFace.shortId}). Sign in instead of creating a new one.`,
        shortId: existingFace.shortId,
      };
    }

    const faceEnc = encryptTemplate(faceNorm);
    const voiceEnc = voiceNorm ? encryptTemplate(voiceNorm) : null;
    const fpEnc = encryptTemplate(fpNorm);
    const identityHash = crypto.createHash('sha256')
      .update(`${faceEnc.hash}:${voiceEnc?.hash ?? 'none'}:${fpEnc.hash}`)
      .digest('hex');

    logger.info('[Auth:Register] ✓ Face template generated', { dimensions: faceNorm.length });
    logger.info('[Auth:Register] ✓ Device authenticator template generated', { dimensions: fpNorm.length, hasWebAuthn: Boolean(boundCredentialId) });
    if (voiceNorm) {
      logger.info('[Auth:Register] ✓ Voice template generated', { dimensions: voiceNorm.length });
    } else {
      logger.info('[Auth:Register] ○ Voice skipped (optional signal)');
    }

    const shortId = await mintUniqueShortId();

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
            webauthnCredentialId: boundCredentialId ?? null,
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
            credentialId: boundCredentialId ?? null,
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
          webauthnCredentialId: boundCredentialId ?? null,
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
        webauthnCredentialId: boundCredentialId,
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

    logger.info('[Auth:Login] ✓ Face template generated', { dimensions: faceNorm.length });
    if (probeVoice) {
      logger.info('[Auth:Login] ✓ Voice template generated', { dimensions: probeVoice.length });
    } else {
      logger.info('[Auth:Login] ○ Voice not provided (optional signal)');
    }

    const candidates = await loadAllFaceTemplates({ activeOnly: true });
    const ranked = rankFaceMatches(faceNorm, candidates);
    const best = ranked.best;
    const bestFaceDist = best?.distance ?? Infinity;
    const bestUserId = best?.userId ?? null;
    const bestShortId = best?.shortId ?? '';
    const bestSource = best?.source ?? '';
    const secondFaceDistance = ranked.secondDistance;

    logger.info('[Auth:Login] 1:N identification', {
      candidateCount: candidates.length,
      bestCandidate: bestShortId || null,
      bestDistance: bestFaceDist === Infinity ? null : Number(bestFaceDist.toFixed(4)),
      secondDistance: Number.isFinite(secondFaceDistance) ? Number(secondFaceDistance.toFixed(4)) : null,
      threshold: THRESHOLDS.faceLogin,
      margin: THRESHOLDS.faceLoginMargin,
      templateSource: bestSource || null,
    });

    const identified = Boolean(bestUserId && isConfidentFaceMatch(bestFaceDist, secondFaceDistance));
    if (!identified || !bestUserId) {
      const ambiguous = Boolean(
        bestUserId
        && bestFaceDist < THRESHOLDS.faceLogin
        && Number.isFinite(secondFaceDistance)
        && secondFaceDistance < THRESHOLDS.faceLogin,
      );
      logger.warn('[Auth:Login] ✗ Authentication result: NO_MATCH', {
        reason: candidates.length === 0
          ? 'empty_registry'
          : ambiguous
            ? 'face_ambiguous_top2'
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
          reason: ambiguous ? 'ambiguous_face_match' : 'no_face_match',
          distance: bestFaceDist,
          secondDistance: secondFaceDistance,
          candidateCount: candidates.length,
        },
      });
      return {
        ok: false,
        matched: false,
        message: candidates.length === 0
          ? 'No Hub identity found yet. Only create a new Hub account if you have never registered this face.'
          : ambiguous
            ? 'Could not uniquely identify this face. Try again in better lighting — do not create a new account.'
            : 'Could not match this face to an existing Pinit ID. Try again — do not create a new account.',
        distance: bestFaceDist === Infinity ? undefined : bestFaceDist.toFixed(4),
      };
    }

    // 1:1 verify against the identified account's enrolled template (never trust 1:N rank alone).
    const enrolledFace = await loadFaceTemplateForUser(bestUserId);
    const oneToOneDist = enrolledFace ? euclideanDistance(faceNorm, enrolledFace) : Infinity;
    if (!enrolledFace || oneToOneDist >= THRESHOLDS.faceLogin) {
      logger.warn('[Auth:Login] ✗ Authentication result: 1:1_REJECTED', {
        bestCandidate: bestShortId,
        oneToOne: Number.isFinite(oneToOneDist) ? oneToOneDist.toFixed(4) : null,
        threshold: THRESHOLDS.faceLogin,
      });
      await logSecurityEvent('BIOMETRIC_FAILURE', {
        ip, userAgent, success: false,
        detail: { reason: 'face_one_to_one_failed', userId: bestUserId, distance: oneToOneDist },
      });
      return {
        ok: false,
        matched: false,
        message: 'Could not verify this face against the identified account. Try again.',
        distance: Number.isFinite(oneToOneDist) ? oneToOneDist.toFixed(4) : undefined,
      };
    }

    let boundCredentialId = webauthnCredentialId;
    if (await credentialIdOwnedByOtherUser(boundCredentialId, bestUserId)) {
      logger.warn('[Auth:Login] Ignoring WebAuthn credential bound to a different user', {
        identifiedShortId: bestShortId,
      });
      boundCredentialId = undefined;
    }
    const probeFp = deriveFingerprintTemplate(boundCredentialId, deviceFingerprint);

    const storedVoice = await loadVoiceForUser(bestUserId);
    const storedFp = await loadFingerprintForUser(bestUserId);

    const voiceDist = storedVoice && probeVoice
      ? euclideanDistance(probeVoice, storedVoice)
      : null;
    const fpDist = storedFp
      ? euclideanDistance(probeFp, storedFp)
      : null;

    const fusion = fuseBiometricScores(
      oneToOneDist,
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
        faceDistance: oneToOneDist.toFixed(4),
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
        message: 'Could not verify this identity. Try face capture again.',
        distance: oneToOneDist.toFixed(4),
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: bestUserId, isActive: true },
      select: { id: true, shortId: true, fullName: true, email: true, role: true, accountType: true },
    });

    if (!user) {
      return { ok: false, matched: false, message: 'Could not verify this identity. Try face capture again.' };
    }

    const deviceId = await upsertDevice(user.id, deviceFingerprint, boundCredentialId);
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
      faceDistance: oneToOneDist.toFixed(4),
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
