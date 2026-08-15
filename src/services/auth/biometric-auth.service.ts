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
  isFaceProbeQualityOk,
  verifyClaimedFace,
  type FusionResult,
} from './biometric-matching.service';
import { logSecurityEvent, logLoginHistory } from './biometric-audit.service';
import { toRootPinitId } from '../../lib/pinit-identity';
import {
  consumePadEvidence,
  padDenyMessage,
  type PadEvidence,
} from './face-liveness.service';
import {
  attachPendingPasskey,
  assertPendingPasskey,
  consumeWebAuthnSession,
  isSimulatedCredentialId,
} from './webauthn.service';
import { decideLoginPasskeyPath } from './webauthn-evaluate';
import { countWebAuthnByUserId } from './webauthn-store';

const JWT_SECRET = config.jwt.secret;

export interface BiometricRegisterInput {
  faceEmbedding: number[];
  padEvidence?: PadEvidence;
  voiceFingerprint?: number[];
  webauthnCredentialId?: string;
  passkeyPendingToken?: string;
  deviceFingerprint?: string;
  accountType?: 'INDIVIDUAL' | 'BUSINESS';
  organizationName?: string;
  ip?: string;
  userAgent?: string;
}

export interface BiometricLoginInput {
  faceEmbedding: number[];
  padEvidence?: PadEvidence;
  /** Claimed Pinit ID (shortId). Required for login — 1:1 verify only. */
  claimedShortId?: string;
  /** Optional UUID claim. Must match claimedShortId if both are sent. */
  claimedUserId?: string;
  voiceFingerprint?: number[];
  webauthnCredentialId?: string;
  passkeyPendingToken?: string;
  webauthnSession?: string;
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

/** JWT.sub is the claimed, verified user id — never a 1:N gallery hit. */
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

  // Any gallery hit under the duplicate threshold is the same person — reject enroll.
  // Do not sign them in here.
  return {
    userId: best.userId,
    shortId: best.shortId,
    distance: best.distance,
    ambiguous: Number.isFinite(secondDistance) && secondDistance < THRESHOLDS.faceDuplicate,
  };
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveClaimedUser(input: {
  claimedShortId?: string;
  claimedUserId?: string;
}): Promise<{ id: string; shortId: string } | null> {
  const claimedUserId = input.claimedUserId?.trim() || '';
  const rawShort = input.claimedShortId?.trim() || '';
  if (!claimedUserId && !rawShort) return null;

  const shortCandidates = new Set<string>();
  if (rawShort) {
    shortCandidates.add(rawShort.toUpperCase());
    const root = toRootPinitId(rawShort);
    if (root) shortCandidates.add(root);
  }

  const or: Array<{ id: string } | { shortId: string }> = [];
  if (claimedUserId && UUID_RE.test(claimedUserId)) or.push({ id: claimedUserId });
  for (const s of shortCandidates) or.push({ shortId: s });
  if (or.length === 0) return null;

  const user = await prisma.user.findFirst({
    where: { isActive: true, faceRegistered: true, OR: or },
    select: { id: true, shortId: true },
  });
  if (!user) return null;

  if (claimedUserId && UUID_RE.test(claimedUserId) && user.id !== claimedUserId) return null;
  return user;
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
      padEvidence,
      voiceFingerprint,
      webauthnCredentialId,
      passkeyPendingToken,
      deviceFingerprint,
      accountType,
      organizationName,
      ip,
      userAgent,
    } = input;

    const resolvedAccountType = accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL';

    if (!isValidTemplate(faceEmbedding) || !isFaceProbeQualityOk(faceEmbedding)) {
      throw new AppError(400, 'Invalid or low-quality face embedding. Recapture and try again.');
    }

    const pad = await consumePadEvidence(padEvidence);
    logger.info('[Auth:Register] PAD', { verdict: pad.verdict, reasons: pad.reasons, scores: pad.scores });
    if (pad.verdict !== 'LIVE') {
      await logSecurityEvent('BIOMETRIC_FAILURE', {
        ip, userAgent, success: false,
        detail: { reason: 'pad_failed', verdict: pad.verdict, reasons: pad.reasons },
      });
      throw new AppError(403, padDenyMessage(pad.verdict, pad.reasons), { pad: pad.verdict });
    }

    const pendingOk = assertPendingPasskey(passkeyPendingToken);
    if (!pendingOk.ok) {
      throw new AppError(403, pendingOk.message, { reason: pendingOk.reason });
    }

    const faceNorm = normalizeEmbedding(faceEmbedding);
    const voiceNorm = voiceFingerprint && isValidTemplate(voiceFingerprint)
      ? normalizeEmbedding(voiceFingerprint)
      : null;
    let boundCredentialId = isSimulatedCredentialId(webauthnCredentialId) ? undefined : webauthnCredentialId;
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

    if (boundCredentialId && await credentialIdOwnedByOtherUser(boundCredentialId)) {
      await logSecurityEvent('DUPLICATE_REGISTRATION', {
        ip, userAgent, success: false,
        detail: { modality: 'webauthn', credentialId: boundCredentialId },
      });
      return {
        ok: false,
        status: 409,
        message: 'This device authenticator is already registered to another Pinit HUB account. Sign in instead.',
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

    const attached = await attachPendingPasskey(passkeyPendingToken, user.id);
    if (!attached.ok) {
      throw new AppError(403, attached.message, { reason: attached.reason });
    }
    boundCredentialId = attached.credentialId;

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
    const {
      faceEmbedding, voiceFingerprint, deviceFingerprint, ip, userAgent,
      claimedShortId, claimedUserId, padEvidence, webauthnSession, passkeyPendingToken,
    } = input;

    const deny = (message: string, distance?: number) => ({
      ok: false as const,
      matched: false as const,
      message,
      distance: distance !== undefined && Number.isFinite(distance) ? distance.toFixed(4) : undefined,
    });
    const denyMsg = 'Could not verify this face for the claimed account.';

    if (!isValidTemplate(faceEmbedding) || !isFaceProbeQualityOk(faceEmbedding)) {
      await logSecurityEvent('BIOMETRIC_FAILURE', {
        ip, userAgent, success: false,
        detail: { reason: 'probe_quality' },
      });
      return deny(denyMsg);
    }

    const pad = await consumePadEvidence(padEvidence);
    logger.info('[Auth:Login] PAD', { verdict: pad.verdict, reasons: pad.reasons, scores: pad.scores });
    if (pad.verdict !== 'LIVE') {
      await logSecurityEvent('BIOMETRIC_FAILURE', {
        ip, userAgent, success: false,
        detail: { reason: 'pad_failed', verdict: pad.verdict, reasons: pad.reasons },
      });
      return deny(padDenyMessage(pad.verdict, pad.reasons));
    }

    const claimed = await resolveClaimedUser({ claimedShortId, claimedUserId });
    if (!claimed) {
      logger.warn('[Auth:Login] ✗ DENY — missing or unknown claimed account', {
        hasShortId: Boolean(claimedShortId?.trim()),
        hasUserId: Boolean(claimedUserId?.trim()),
      });
      await logSecurityEvent('BIOMETRIC_FAILURE', {
        ip, userAgent, success: false,
        detail: { reason: claimedShortId || claimedUserId ? 'unknown_claim' : 'no_claim' },
      });
      return deny(
        claimedShortId || claimedUserId
          ? denyMsg
          : 'Enter your Pinit ID, then verify your face against that account.',
      );
    }

    // Identity is locked to the claim. Never search the gallery or switch user.
    const verifiedUserId = claimed.id;
    const faceNorm = normalizeEmbedding(faceEmbedding);
    const enrolledFace = await loadFaceTemplateForUser(verifiedUserId);
    const verified = verifyClaimedFace({
      claimedUserId: verifiedUserId,
      probe: faceNorm,
      enrolled: enrolledFace,
      threshold: THRESHOLDS.faceLogin,
    });

    logger.info('[Auth:Login] 1:1 verification (claimed account only)', {
      claimedShortId: claimed.shortId,
      claimedUserId: verifiedUserId,
      ok: verified.ok,
      reason: verified.ok ? 'match' : verified.reason,
      distance: verified.ok ? Number(verified.distance.toFixed(4)) : null,
      threshold: THRESHOLDS.faceLogin,
    });

    if (!verified.ok) {
      const mismatchDist = enrolledFace ? euclideanDistance(faceNorm, enrolledFace) : undefined;
      logger.warn('[Auth:Login] ✗ Authentication result: DENY', {
        claimedShortId: claimed.shortId,
        reason: verified.reason,
      });
      await logSecurityEvent('BIOMETRIC_FAILURE', {
        ip, userAgent, success: false,
        detail: { reason: `verify_${verified.reason}`, claimedUserId: verifiedUserId },
      });
      return deny(denyMsg, mismatchDist);
    }

    const oneToOneDist = verified.distance;
    const probeVoice = voiceFingerprint && isValidTemplate(voiceFingerprint)
      ? normalizeEmbedding(voiceFingerprint)
      : null;

    let boundCredentialId: string | undefined;
    const existingPasskeyCount = await countWebAuthnByUserId(verifiedUserId);
    const passkeyPath = decideLoginPasskeyPath({
      hasWebauthnSession: Boolean(webauthnSession),
      hasPendingToken: Boolean(passkeyPendingToken),
      existingPasskeyCount,
    });

    if (passkeyPath.action === 'consume_session') {
      const sess = consumeWebAuthnSession(webauthnSession, verifiedUserId);
      if (!sess.ok) {
        await logSecurityEvent('BIOMETRIC_FAILURE', {
          ip, userAgent, success: false,
          detail: { reason: 'webauthn_mismatch', webauthn: sess.reason, claimedUserId: verifiedUserId },
        });
        return deny(sess.message);
      }
      boundCredentialId = sess.credentialId;
    } else if (passkeyPath.action === 'enroll_pending') {
      // First-time only (existingPasskeyCount === 0). Never enroll onto accounts that already have passkeys.
      const attached = await attachPendingPasskey(passkeyPendingToken, verifiedUserId);
      if (!attached.ok) {
        await logSecurityEvent('BIOMETRIC_FAILURE', {
          ip, userAgent, success: false,
          detail: { reason: 'webauthn_enroll_failed', webauthn: attached.reason, claimedUserId: verifiedUserId },
        });
        return deny(attached.message);
      }
      boundCredentialId = attached.credentialId;
    } else if (passkeyPath.reason === 'existing_passkey_required') {
      await logSecurityEvent('BIOMETRIC_FAILURE', {
        ip, userAgent, success: false,
        detail: {
          reason: 'existing_passkey_required',
          claimedUserId: verifiedUserId,
          existingPasskeyCount,
        },
      });
      return deny(
        'This account already has a passkey. Verify with the authenticator registered to this Pinit account.',
      );
    } else if (passkeyPath.reason === 'passkey_required') {
      return deny('Verify this device with the passkey registered to this Pinit account.');
    } else {
      return deny('Verify this device with a passkey, then try again.');
    }

    const probeFp = deriveFingerprintTemplate(boundCredentialId, deviceFingerprint);

    const storedVoice = await loadVoiceForUser(verifiedUserId);
    const storedFp = await loadFingerprintForUser(verifiedUserId);

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
      },
    );

    logger.info('[Auth:Login] Fusion scores', {
      claimedShortId: claimed.shortId,
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
      logger.warn('[Auth:Login] ✗ Authentication result: DENY (fusion)', {
        claimedShortId: claimed.shortId,
        faceDistance: oneToOneDist.toFixed(4),
        threshold: THRESHOLDS.faceLogin,
      });
      await logLoginHistory({
        userId: verifiedUserId,
        method: 'biometric_login',
        ip, userAgent,
        success: false,
        failReason: 'face_verification_failed',
      });
      return deny(denyMsg, oneToOneDist);
    }

    const user = await prisma.user.findUnique({
      where: { id: verifiedUserId, isActive: true },
      select: { id: true, shortId: true, fullName: true, email: true, role: true, accountType: true },
    });

    if (!user || user.id !== verifiedUserId) {
      return deny(denyMsg);
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
      detail: { confidence: fusion.overallConfidence, scores: fusion.scores, claimedUserId: verifiedUserId },
    });
    await logLoginHistory({ userId: user.id, method: 'biometric_login', ip, userAgent, success: true });

    logger.info('[Auth:Login] ✓ Authentication result: SUCCESS', {
      userId: user.id,
      pinitId: user.shortId,
      jwtSub: user.id,
      confidence: fusion.overallConfidence,
      faceDistance: oneToOneDist.toFixed(4),
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
