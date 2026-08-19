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
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { config } from '../../config';
import { AppError } from '../../api/middleware/error.middleware';
import {
  encryptTemplate,
  decryptTemplate,
  hashSessionToken,
  CURRENT_ENCRYPTION_KEY_VERSION,
} from './biometric-crypto.service';
import {
  THRESHOLDS,
  normalizeEmbedding,
  euclideanDistance,
  deriveFingerprintTemplate,
  fuseBiometricScores,
  isValidTemplate,
  rankFaceMatches,
  rankVoiceMatches,
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
import { countWebAuthnByUserId, findWebAuthnByCredentialId } from './webauthn-store';

const JWT_SECRET = config.jwt.secret;

/** Any db handle a query can run against — the ambient singleton, or a transaction. */
type Db = PrismaClient | Prisma.TransactionClient;

/** One generic message for every duplicate-registration reason (face or voice) —
 * never reveals which modality collided, the other account's shortId, or a distance. */
const DUPLICATE_ACCOUNT_MESSAGE = "You're already registered with PINIT.";

/**
 * Stamped on templates at enrollment so a future model/algorithm upgrade can
 * migrate or force re-enrollment deliberately, instead of silently comparing
 * new probes against templates the old model produced.
 */
const FACE_MODEL_VERSION = 'face-api-tiny-v1';
const VOICE_MODEL_VERSION = 'web-audio-fft-v1';
const FINGERPRINT_MODEL_VERSION = 'webauthn-device-v1';
const EMBEDDING_VERSION = '1';
const ALGORITHM_VERSION = '1';

/** Registration is rolled back for one of these reasons — mapped to a generic
 * response at the outer catch in register() so nothing about which modality
 * or which account collided ever reaches the client. Exported for unit testing
 * the error->response mapping without needing a live Postgres transaction. */
export class DuplicateFaceError extends Error {
  constructor(public readonly match: { shortId: string; distance: number; ambiguous?: boolean }) {
    super('duplicate_face');
    this.name = 'DuplicateFaceError';
  }
}
export class DuplicateVoiceError extends Error {
  constructor(public readonly match: { shortId: string; distance: number; ambiguous?: boolean }) {
    super('duplicate_voice');
    this.name = 'DuplicateVoiceError';
  }
}
class WebAuthnOwnedError extends Error {
  constructor() {
    super('webauthn_owned');
    this.name = 'WebAuthnOwnedError';
  }
}
class PasskeyAttachError extends Error {
  constructor(message: string, public readonly reason: string) {
    super(message);
    this.name = 'PasskeyAttachError';
  }
}

function isShortIdCollision(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError
    && e.code === 'P2002'
    && Array.isArray(e.meta?.['target'])
    && (e.meta!['target'] as string[]).includes('shortId')
  );
}

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

/**
 * Never attach a WebAuthn / device credential that already belongs to another user.
 * Queries the authoritative WebAuthnCredential table (credentialId is DB-unique there),
 * not the stale User.webauthnCredentialId pointer — that field only ever reflects the
 * last-attached credential and is not a uniqueness source of truth.
 */
async function credentialIdOwnedByOtherUser(
  credentialId: string | undefined,
  userId?: string,
  db: Db = prisma,
): Promise<boolean> {
  if (!credentialId) return false;
  const row = await findWebAuthnByCredentialId(credentialId, db);
  if (!row) return false;
  return row.userId !== userId;
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

async function loadAllFaceTemplates(db: Db = prisma, opts?: {
  activeOnly?: boolean;
}): Promise<Array<{ userId: string; shortId: string; embedding: number[]; source: string }>> {
  const users = await db.user.findMany({
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
 * 1:N enroll search. Face is the only PRIMARY uniqueness gate (voice mirrors this
 * as a secondary gate below). A hit means "this person already has an account" —
 * never mint or sign them in here. Device fingerprint / WebAuthn must not decide
 * identity on a shared browser.
 *
 * Accepts an optional `db` so the AUTHORITATIVE duplicate check in register() can
 * run against the same locked transaction (`tx`) that also does the insert — see
 * register()'s advisory-lock section. A caller-side "fast path" check against the
 * ambient `prisma` (db omitted) is advisory only and must never be trusted alone.
 */
async function findMatchingFace(
  face: number[],
  db: Db = prisma,
): Promise<{ userId: string; shortId: string; distance: number; ambiguous?: boolean } | null> {
  const faceNorm = normalizeEmbedding(face);
  const faces = await loadAllFaceTemplates(db);
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

async function loadAllVoiceTemplates(db: Db = prisma): Promise<Array<{ userId: string; shortId: string; embedding: number[]; source: string }>> {
  const users = await db.user.findMany({
    where: { voiceRegistered: true },
    select: {
      id: true,
      shortId: true,
      voiceEmbedding: true,
      biometricIdentity: { include: { voiceTemplate: true } },
    },
  });

  const results: Array<{ userId: string; shortId: string; embedding: number[]; source: string }> = [];

  for (const u of users) {
    let embedding: number[] | null = null;
    let source = 'none';

    if (u.biometricIdentity?.voiceTemplate) {
      try {
        embedding = normalizeEmbedding(decryptTemplate(u.biometricIdentity.voiceTemplate.templateCipher));
        source = 'enterprise_cipher';
      } catch (err) {
        logger.warn('[Auth] Voice cipher decrypt failed — falling back to user.voiceEmbedding', {
          userId: u.id,
          shortId: u.shortId,
          error: String(err),
        });
      }
    }

    if (!embedding && u.voiceEmbedding.length === 128) {
      embedding = normalizeEmbedding(u.voiceEmbedding);
      source = u.biometricIdentity?.voiceTemplate ? 'user_fallback' : 'user_plain';
    }

    if (embedding) {
      results.push({ userId: u.id, shortId: u.shortId, embedding, source });
    }
  }

  return results;
}

/**
 * 1:N voice enroll search — mirrors findMatchingFace exactly. Voice is a secondary
 * factor (face is the primary identity anchor), but a hit here still rejects the
 * whole registration — see register()'s transaction, which rolls back everything
 * on a voice-duplicate hit, not just the voice template.
 */
async function findMatchingVoice(
  voice: number[],
  db: Db = prisma,
): Promise<{ userId: string; shortId: string; distance: number; ambiguous?: boolean } | null> {
  const voiceNorm = normalizeEmbedding(voice);
  const voices = await loadAllVoiceTemplates(db);
  const { best, secondDistance } = rankVoiceMatches(voiceNorm, voices);

  if (!best) {
    return null;
  }

  logger.info('[Auth:Register] Voice uniqueness check', {
    nearestShortId: best.shortId,
    nearestDistance: Number(best.distance.toFixed(4)),
    secondDistance: Number.isFinite(secondDistance) ? Number(secondDistance.toFixed(4)) : null,
    threshold: THRESHOLDS.voiceDuplicate,
    compared: voices.length,
  });

  if (best.distance >= THRESHOLDS.voiceDuplicate) {
    return null;
  }

  return {
    userId: best.userId,
    shortId: best.shortId,
    distance: best.distance,
    ambiguous: Number.isFinite(secondDistance) && secondDistance < THRESHOLDS.voiceDuplicate,
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
    | { ok: false; status: 409; message: string }
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
    // Client-claimed credential id, not yet verified as belonging to this registration —
    // only ever persisted after attachPendingPasskey verifies it inside the transaction below.
    const rawCredentialId = isSimulatedCredentialId(webauthnCredentialId) ? undefined : webauthnCredentialId;
    const fpNorm = deriveFingerprintTemplate(rawCredentialId, deviceFingerprint);

    const faceEnc = encryptTemplate(faceNorm);
    const voiceEnc = voiceNorm ? encryptTemplate(voiceNorm) : null;
    const fpEnc = encryptTemplate(fpNorm);
    const identityHash = crypto.createHash('sha256')
      .update(`${faceEnc.hash}:${voiceEnc?.hash ?? 'none'}:${fpEnc.hash}`)
      .digest('hex');

    logger.info('[Auth:Register] ✓ Face template generated', { dimensions: faceNorm.length });
    logger.info('[Auth:Register] ✓ Device authenticator template generated', { dimensions: fpNorm.length, hasWebAuthn: Boolean(rawCredentialId) });
    if (voiceNorm) {
      logger.info('[Auth:Register] ✓ Voice template generated', { dimensions: voiceNorm.length });
    } else {
      logger.info('[Auth:Register] ○ Voice skipped (optional signal)');
    }

    /**
     * Face + (optional) voice duplicate detection and the entire account creation
     * happen inside ONE locked transaction. This fixes two real bugs: (1) a TOCTOU
     * race where two concurrent registrations with the same face could both pass
     * the duplicate check before either committed, and (2) an orphan-account bug
     * where WebAuthn credential attachment used to run AFTER this transaction
     * committed, so a failed attach left a credential-less account behind.
     *
     * Deliberately single-path: there is no separate "fast" duplicate pre-check
     * outside the lock, only this authoritative one — one place for this logic to
     * live, one place it can be wrong. Registration volume is low, so serializing
     * registration behind a single global advisory lock is an accepted, explicit
     * tradeoff over a more granular (and more error-prone) locking scheme.
     */
    const attempt = (shortId: string) => prisma.$transaction(async (tx) => {
      // Transaction-scoped advisory locks — auto-released on commit/rollback.
      // Fixed order (face, then voice) avoids lock-ordering deadlocks between two
      // concurrent registrations that both provide voice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pinit:biometric:face:register'))`;
      if (voiceNorm) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pinit:biometric:voice:register'))`;
      }

      const dupFace = await findMatchingFace(faceNorm, tx);
      if (dupFace) throw new DuplicateFaceError(dupFace);

      if (voiceNorm) {
        const dupVoice = await findMatchingVoice(voiceNorm, tx);
        if (dupVoice) throw new DuplicateVoiceError(dupVoice);
      }

      if (rawCredentialId && await credentialIdOwnedByOtherUser(rawCredentialId, undefined, tx)) {
        throw new WebAuthnOwnedError();
      }

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
          // Not set from the client-claimed rawCredentialId — only ever set below,
          // after attachPendingPasskey verifies it, so an unverified id is never
          // persisted even transiently within this transaction.
          webauthnCredentialId: null,
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
          embeddingVersion: EMBEDDING_VERSION,
          modelVersion: FACE_MODEL_VERSION,
          algorithmVersion: ALGORITHM_VERSION,
          // Real signal from the PAD evaluation that already ran above, not a
          // fabricated score. Null only if PAD reported no usable sharpness.
          qualityScore: Number.isFinite(pad.scores.sharpness) ? pad.scores.sharpness : null,
          encryptionKeyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
        },
      });

      if (voiceEnc) {
        await tx.voiceTemplate.create({
          data: {
            biometricIdentityId: identity.id,
            templateCipher: voiceEnc.cipher,
            templateHash: voiceEnc.hash,
            embeddingVersion: EMBEDDING_VERSION,
            modelVersion: VOICE_MODEL_VERSION,
            algorithmVersion: ALGORITHM_VERSION,
            // No server-side voice quality metric exists — gating happens
            // client-side and never reaches us. Left null rather than invented.
            qualityScore: null,
            encryptionKeyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
          },
        });
      }

      await tx.fingerprintTemplate.create({
        data: {
          biometricIdentityId: identity.id,
          templateCipher: fpEnc.cipher,
          templateHash: fpEnc.hash,
          credentialId: rawCredentialId ?? null,
          embeddingVersion: EMBEDDING_VERSION,
          modelVersion: FINGERPRINT_MODEL_VERSION,
          algorithmVersion: ALGORITHM_VERSION,
          // Derived device proxy, not a captured biometric sample — no quality.
          qualityScore: null,
          encryptionKeyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
        },
      });

      // The WebAuthn ceremony (browser attestation) already happened as its own
      // HTTP round trip before register() was ever called — passkeyPendingToken is
      // its already-verified result. Only the DB write is left, and it now runs
      // inside this same transaction: if it fails, everything above rolls back too.
      const attached = await attachPendingPasskey(passkeyPendingToken, u.id, tx);
      if (!attached.ok) {
        throw new PasskeyAttachError(attached.message, attached.reason);
      }

      return { user: u, attachedCredentialId: attached.credentialId };
    }, { timeout: 20_000, maxWait: 10_000 });

    let result: Awaited<ReturnType<typeof attempt>> | undefined;
    let lastError: unknown;
    for (let n = 0; n < 2 && !result; n++) {
      try {
        const shortId = await mintUniqueShortId();
        result = await attempt(shortId);
      } catch (e) {
        lastError = e;
        // shortId collision on insert is astronomically rare (mintUniqueShortId
        // already pre-checks) but the @unique constraint is the real guarantee —
        // retry once with a freshly minted id before giving up.
        if (isShortIdCollision(e) && n === 0) {
          logger.warn('[Auth:Register] shortId collision on insert — retrying once');
          continue;
        }
        break;
      }
    }

    if (!result) {
      const e = lastError;
      if (e instanceof DuplicateFaceError) {
        await logSecurityEvent('FACE_DUPLICATE_REJECTED', {
          ip, userAgent, success: false,
          detail: { modality: 'face', existingShortId: e.match.shortId, distance: e.match.distance, ambiguous: Boolean(e.match.ambiguous) },
        });
        return { ok: false, status: 409, message: DUPLICATE_ACCOUNT_MESSAGE };
      }
      if (e instanceof DuplicateVoiceError) {
        await logSecurityEvent('VOICE_DUPLICATE_REJECTED', {
          ip, userAgent, success: false,
          detail: { modality: 'voice', existingShortId: e.match.shortId, distance: e.match.distance, ambiguous: Boolean(e.match.ambiguous) },
        });
        return { ok: false, status: 409, message: DUPLICATE_ACCOUNT_MESSAGE };
      }
      if (e instanceof WebAuthnOwnedError) {
        await logSecurityEvent('DUPLICATE_REGISTRATION', {
          ip, userAgent, success: false,
          detail: { modality: 'webauthn', credentialId: rawCredentialId },
        });
        return {
          ok: false,
          status: 409,
          message: 'This device authenticator is already registered to another Pinit HUB account. Sign in instead.',
        };
      }
      if (e instanceof PasskeyAttachError) {
        throw new AppError(403, e.message, { reason: e.reason });
      }
      if (isShortIdCollision(e)) {
        throw new AppError(500, 'Could not allocate a unique PINIT ID. Try again.');
      }
      throw e;
    }

    const { user, attachedCredentialId } = result;
    logger.info('[Auth:Register] ✓ Registration transaction committed', { userId: user.id, shortId: user.shortId, pinitId: user.shortId });

    // Per-modality enrollment audit. Only fires after the transaction commits,
    // so an event can never describe an enrollment that was rolled back.
    await logSecurityEvent('FACE_REGISTERED', {
      userId: user.id, ip, userAgent,
      detail: { shortId: user.shortId, modelVersion: FACE_MODEL_VERSION },
    });
    if (voiceNorm) {
      await logSecurityEvent('VOICE_REGISTERED', {
        userId: user.id, ip, userAgent,
        detail: { shortId: user.shortId, modelVersion: VOICE_MODEL_VERSION },
      });
    }
    await logSecurityEvent('WEBAUTHN_REGISTERED', {
      userId: user.id, ip, userAgent,
      detail: { shortId: user.shortId, credentialId: attachedCredentialId },
    });

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
        webauthnCredentialId: attachedCredentialId,
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
    });

    return { ok: true, ...session };
  },

  async login(input: BiometricLoginInput): Promise<
    | { ok: true; user: AuthUser; tokens: AuthTokens; confidence: number; fusion: FusionResult }
    | { ok: false; matched: false; message: string }
  > {
    const {
      faceEmbedding, voiceFingerprint, deviceFingerprint, ip, userAgent,
      claimedShortId, claimedUserId, padEvidence, webauthnSession, passkeyPendingToken,
    } = input;

    /** Never carries a similarity distance — a caller must not be able to learn
     * how close a probe was to the enrolled template. */
    const deny = (message: string) => ({
      ok: false as const,
      matched: false as const,
      message,
    });
    const denyMsg = 'Could not verify this face for the claimed account.';

    if (!isValidTemplate(faceEmbedding) || !isFaceProbeQualityOk(faceEmbedding)) {
      await logSecurityEvent('FACE_LOGIN_FAILED', {
        ip, userAgent, success: false,
        detail: { reason: 'probe_quality' },
      });
      return deny(denyMsg);
    }

    const pad = await consumePadEvidence(padEvidence);
    logger.info('[Auth:Login] PAD', { verdict: pad.verdict, reasons: pad.reasons, scores: pad.scores });
    if (pad.verdict !== 'LIVE') {
      await logSecurityEvent('FACE_LOGIN_FAILED', {
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
      await logSecurityEvent('FACE_LOGIN_FAILED', {
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
      logger.warn('[Auth:Login] ✗ Authentication result: DENY', {
        claimedShortId: claimed.shortId,
        reason: verified.reason,
      });
      await logSecurityEvent('FACE_LOGIN_FAILED', {
        ip, userAgent, success: false,
        detail: { reason: `verify_${verified.reason}`, claimedUserId: verifiedUserId },
      });
      return deny(denyMsg);
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
        await logSecurityEvent('WEBAUTHN_LOGIN_FAILED', {
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
        await logSecurityEvent('WEBAUTHN_LOGIN_FAILED', {
          ip, userAgent, success: false,
          detail: { reason: 'webauthn_enroll_failed', webauthn: attached.reason, claimedUserId: verifiedUserId },
        });
        return deny(attached.message);
      }
      boundCredentialId = attached.credentialId;
    } else if (passkeyPath.reason === 'existing_passkey_required') {
      await logSecurityEvent('WEBAUTHN_LOGIN_FAILED', {
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
      return deny(denyMsg);
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

    // Persisted audit carries no similarity distances — fusion.scores holds
    // face/voice/fingerprint distances, which must not land in stored events.
    await logSecurityEvent('FACE_LOGIN_SUCCESS', {
      userId: user.id, ip, userAgent, deviceId,
      detail: { claimedUserId: verifiedUserId, shortId: user.shortId },
    });
    if (passkeyPath.action === 'consume_session') {
      // Only when an already-enrolled authenticator was actually verified —
      // not when a first passkey was just enrolled during this login.
      await logSecurityEvent('WEBAUTHN_LOGIN_SUCCESS', {
        userId: user.id, ip, userAgent, deviceId,
        detail: { claimedUserId: verifiedUserId, credentialId: boundCredentialId },
      });
    }
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
