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
  type FusionResult,
} from './biometric-matching.service';
import { logSecurityEvent, logLoginHistory } from './biometric-audit.service';

const JWT_SECRET = config.jwt.secret;

export interface BiometricRegisterInput {
  faceEmbedding: number[];
  voiceFingerprint?: number[];
  webauthnCredentialId?: string;
  deviceFingerprint?: string;
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

function createTokens(user: { id: string; shortId: string; fullName: string; role: string }): AuthTokens {
  const accessToken = jwt.sign(
    { sub: user.id, shortId: user.shortId, name: user.fullName, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
  const refreshToken = jwt.sign({ sub: user.id, type: 'refresh' }, JWT_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}

async function loadAllFaceTemplates(): Promise<Array<{ userId: string; shortId: string; embedding: number[]; source: string }>> {
  const users = await prisma.user.findMany({
    where: { faceRegistered: true },
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
  });

  return results;
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

async function findDuplicateModality(
  face: number[],
  voice?: number[],
  fingerprint?: number[],
): Promise<{ modality: string; shortId: string } | null> {
  const faceNorm = normalizeEmbedding(face);
  const faces = await loadAllFaceTemplates();
  for (const f of faces) {
    if (euclideanDistance(faceNorm, f.embedding) < THRESHOLDS.faceDuplicate) {
      return { modality: 'face', shortId: f.shortId };
    }
  }

  if (voice && isValidTemplate(voice)) {
    const voiceNorm = normalizeEmbedding(voice);
    const voiceTemplates = await prisma.voiceTemplate.findMany({
      include: { biometricIdentity: { include: { user: { select: { shortId: true } } } } },
    });
    for (const vt of voiceTemplates) {
      try {
        const stored = normalizeEmbedding(decryptTemplate(vt.templateCipher));
        if (euclideanDistance(voiceNorm, stored) < THRESHOLDS.voiceDuplicate) {
          return { modality: 'voice', shortId: vt.biometricIdentity.user.shortId };
        }
      } catch { /* skip */ }
    }
    const legacyVoice = await prisma.user.findMany({
      where: { voiceRegistered: true, biometricIdentity: null },
      select: { shortId: true, voiceEmbedding: true },
    });
    for (const u of legacyVoice) {
      if (u.voiceEmbedding.length === 128) {
        const d = euclideanDistance(voiceNorm, normalizeEmbedding(u.voiceEmbedding));
        if (d < THRESHOLDS.voiceDuplicate) return { modality: 'voice', shortId: u.shortId };
      }
    }
  }

  if (fingerprint) {
    const fpNorm = normalizeEmbedding(fingerprint);
    const fpTemplates = await prisma.fingerprintTemplate.findMany({
      include: { biometricIdentity: { include: { user: { select: { shortId: true } } } } },
    });
    for (const ft of fpTemplates) {
      try {
        const stored = normalizeEmbedding(decryptTemplate(ft.templateCipher));
        if (euclideanDistance(fpNorm, stored) < THRESHOLDS.fingerprintDuplicate) {
          return { modality: 'fingerprint', shortId: ft.biometricIdentity.user.shortId };
        }
      } catch { /* skip */ }
    }
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
    | { ok: true; user: AuthUser; tokens: AuthTokens }
    | { ok: false; status: 409; message: string; shortId?: string }
  > {
    const { faceEmbedding, voiceFingerprint, webauthnCredentialId, deviceFingerprint, ip, userAgent } = input;

    if (!isValidTemplate(faceEmbedding)) {
      throw new Error('Invalid face embedding. Must be 128-dimensional float array.');
    }

    const faceNorm = normalizeEmbedding(faceEmbedding);
    const voiceNorm = voiceFingerprint && isValidTemplate(voiceFingerprint)
      ? normalizeEmbedding(voiceFingerprint)
      : undefined;
    const fpNorm = deriveFingerprintTemplate(webauthnCredentialId, deviceFingerprint);

    const duplicate = await findDuplicateModality(faceNorm, voiceNorm, fpNorm);
    if (duplicate) {
      await logSecurityEvent('DUPLICATE_REGISTRATION', {
        ip, userAgent, success: false,
        detail: { modality: duplicate.modality, existingShortId: duplicate.shortId },
      });
      return {
        ok: false,
        status: 409,
        message: 'This biometric identity already exists. Please sign in using your existing identity.',
        shortId: duplicate.shortId,
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
    } else {
      logger.info('[Auth:Register] ○ Voice template skipped (not provided)');
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

    const persisted = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        faceRegistered: true,
        voiceRegistered: true,
        biometricIdentity: {
          select: {
            id: true,
            faceTemplate: { select: { id: true } },
            voiceTemplate: { select: { id: true } },
            fingerprintTemplate: { select: { id: true } },
          },
        },
      },
    });

    if (persisted?.biometricIdentity?.faceTemplate) {
      logger.info('[Auth:Register] ✓ Face template stored (encrypted)', { identityId: persisted.biometricIdentity.id });
    } else {
      logger.info('[Auth:Register] ✓ Face template stored (user.faceEmbedding)', { dimensions: faceNorm.length });
    }
    if (voiceNorm) {
      logger.info('[Auth:Register] ✓ Voice stored', {
        encrypted: Boolean(persisted?.biometricIdentity?.voiceTemplate),
        voiceRegistered: persisted?.voiceRegistered,
      });
    }
    if (persisted?.biometricIdentity?.fingerprintTemplate) {
      logger.info('[Auth:Register] ✓ Fingerprint stored (encrypted)');
    } else {
      logger.info('[Auth:Register] ✓ Fingerprint stored (derived template)');
    }
    logger.info('[Auth:Register] Pipeline complete', {
      userId: user.id,
      pinitId: user.shortId,
      enterpriseTables: usedEnterpriseTables,
    });

    const deviceId = await upsertDevice(user.id, deviceFingerprint, webauthnCredentialId);
    const tokens = createTokens({ id: user.id, shortId: user.shortId, fullName: user.fullName, role: user.role });
    await createSession(user.id, tokens.refreshToken, ip, userAgent, deviceId);

    await logSecurityEvent('REGISTRATION', { userId: user.id, ip, userAgent, deviceId, detail: { shortId } });
    await logLoginHistory({ userId: user.id, method: 'biometric_register', ip, userAgent, success: true });

    logger.info('Enterprise biometric registration complete', { shortId, userId: user.id });

    return {
      ok: true,
      user: { id: user.id, shortId: user.shortId, fullName: user.fullName, email: user.email, role: user.role },
      tokens,
    };
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

    const candidates = await loadAllFaceTemplates();
    let bestUserId: string | null = null;
    let bestShortId = '';
    let bestFaceDist = Infinity;
    let bestSource = '';

    for (const c of candidates) {
      const d = euclideanDistance(faceNorm, c.embedding);
      if (d < bestFaceDist) {
        bestFaceDist = d;
        bestUserId = c.userId;
        bestShortId = c.shortId;
        bestSource = c.source;
      }
    }

    logger.info('[Auth:Login] Matching score', {
      candidateCount: candidates.length,
      bestCandidate: bestShortId || null,
      bestDistance: bestFaceDist === Infinity ? null : Number(bestFaceDist.toFixed(4)),
      threshold: THRESHOLDS.faceLogin,
      templateSource: bestSource || null,
    });

    if (!bestUserId || bestFaceDist >= THRESHOLDS.faceLogin) {
      logger.warn('[Auth:Login] ✗ Authentication result: NO_MATCH', {
        reason: candidates.length === 0 ? 'empty_registry' : 'face_distance_above_threshold',
        bestDistance: bestFaceDist === Infinity ? null : bestFaceDist.toFixed(4),
        threshold: THRESHOLDS.faceLogin,
      });
      await logSecurityEvent('BIOMETRIC_FAILURE', {
        ip, userAgent, success: false,
        detail: { reason: 'no_face_match', distance: bestFaceDist, candidateCount: candidates.length },
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
      { hasVoice: Boolean(storedVoice && probeVoice), hasFingerprint: Boolean(storedFp) },
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
      select: { id: true, shortId: true, fullName: true, email: true, role: true },
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

    const tokens = createTokens(user);
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
};
