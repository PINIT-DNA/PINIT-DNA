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
  isFaceVerified1to1,
  isIdentifyAccept,
  verifyClaimedFace,
  THRESHOLDS as MATCH_THRESHOLDS,
  type FusionResult,
} from './biometric-matching.service';
import { logSecurityEvent, logLoginHistory, sanitizeLoginLighting } from './biometric-audit.service';
import { loginThrottle } from './login-throttle.service';
import { toRootPinitId } from '../../lib/pinit-identity';
import { BIOMETRIC_DECISION, decisionFromClaimedVerify, publicBiometricMessage } from './biometric-decision';
import { acceptProbeForActiveEngine } from './recognition-engine';
import { mayIssueSession } from './face-auth-machine';
import { issueEnrollmentClaim, readEnrollmentClaim } from './enrollment-claim';
import { searchFaceGallery } from './face-gallery';
import {
  padDenyMessage,
  type PadEvidence,
} from './face-liveness.service';
import { traceBiometric, verifyPassivePad } from './passive-pad-engine';
import {
  attachPendingPasskey,
  assertPendingPasskey,
  isSimulatedCredentialId,
} from './webauthn.service';
import { findWebAuthnByCredentialId } from './webauthn-store';

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

export interface FaceEnrollmentSample {
  embedding: number[];
  padEvidence?: PadEvidence;
}

export interface BiometricRegisterInput {
  faceEmbedding: number[];
  /** Live samples. When present, each one is checked before they are combined. */
  faceSamples?: FaceEnrollmentSample[];
  /** Reserved Pinit ID from beginEnrollment. The face binds to this id. */
  enrollmentToken?: string;
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

export interface FaceLoginClientTelemetry {
  ambientBrightness?: number;
  lightingStatus?: string;
}

export interface FaceLoginPerf {
  padMs: number;
  claimMs: number;
  decryptMs: number;
  matchMs: number;
  jwtMs?: number;
  totalMs: number;
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
  lightingTelemetry?: FaceLoginClientTelemetry;
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

async function fuseEnrollmentSamples(
  samples: FaceEnrollmentSample[],
): Promise<{ faceNorm: number[]; sharpness: number | null }> {
  if (samples.length < 1 || samples.length > 5) {
    throw new AppError(400, 'Enrollment needs between 1 and 5 live face samples.');
  }
  const accepted: number[][] = [];
  let sharpness: number | null = null;
  for (const sample of samples) {
    if (!acceptProbeForActiveEngine(sample.embedding) || !isValidTemplate(sample.embedding) || !isFaceProbeQualityOk(sample.embedding)) {
      throw new AppError(400, 'A face sample was not clear enough. Recapture and try again.');
    }
    const pad = await verifyPassivePad(sample.padEvidence);
    if (pad.verdict !== 'LIVE') {
      throw new AppError(403, padDenyMessage(pad.verdict, pad.reasons), { pad: pad.verdict });
    }
    if (Number.isFinite(pad.scores.sharpness)) sharpness = pad.scores.sharpness;
    accepted.push(normalizeEmbedding(sample.embedding));
  }
  for (let i = 0; i < accepted.length; i += 1) {
    for (let j = i + 1; j < accepted.length; j += 1) {
      const distance = euclideanDistance(accepted[i]!, accepted[j]!);
      if (!isFaceVerified1to1(distance)) {
        throw new AppError(400, 'Those face samples do not look like the same person. Recapture and try again.');
      }
    }
  }
  const dim = accepted[0]!.length;
  const mean = new Array<number>(dim).fill(0);
  for (const row of accepted) {
    for (let i = 0; i < dim; i += 1) mean[i] = (mean[i] ?? 0) + (row[i] ?? 0);
  }
  for (let i = 0; i < dim; i += 1) mean[i] = (mean[i] ?? 0) / accepted.length;
  return { faceNorm: normalizeEmbedding(mean), sharpness };
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
  lastActiveShell?: 'PERSONAL' | 'BUSINESS';
}): AuthTokens {
  const accessToken = jwt.sign(
    {
      sub: user.id,
      shortId: user.shortId,
      name: user.fullName,
      role: user.role,
      accountType: user.accountType ?? 'INDIVIDUAL',
      lastActiveShell: user.lastActiveShell === 'BUSINESS' ? 'BUSINESS' : 'PERSONAL',
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
        logger.warn('[Auth] Face cipher decrypt failed', {
          userId: u.id,
          shortId: u.shortId,
          error: String(err),
        });
      }
    }

    if (embedding) {
      results.push({ userId: u.id, shortId: u.shortId, embedding, source });
    } else {
      logger.warn('[Auth] Registered user has no usable encrypted face template', {
        userId: u.id,
        shortId: u.shortId,
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
 * 1:N voice enroll search. Its caller in register() logs a hit but no longer
 * rejects on it — voice-fingerprint.ts derives the template from an averaged
 * FFT spectrum, not a trained speaker embedding, so it mostly encodes mic/room
 * acoustics and produced a confirmed false-positive collision between two
 * different real people in production (2026-08-19). Face is the sole
 * uniqueness gate until voice capture uses real speaker-discriminative
 * features.
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

  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 1:N search with the same acceptance rule as face identify: the nearest
 * enrolled face must be inside faceIdentify and clearly ahead of the next one.
 * Used only after liveness has passed. Returns the account to verify 1:1, or null.
 */
async function findConfidentFaceMatch(probe: number[]): Promise<{ id: string; shortId: string } | null> {
  const gallery = await loadAllFaceTemplates(prisma, { activeOnly: true });
  const { best, secondDistance } = searchFaceGallery(probe, gallery);
  if (!best || !isIdentifyAccept(best.distance, secondDistance, MATCH_THRESHOLDS.faceIdentify)) return null;
  const user = await prisma.user.findFirst({
    where: { id: best.userId, isActive: true, faceRegistered: true },
    select: { id: true, shortId: true },
  });
  return user ?? null;
}

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
  user: {
    id: string;
    shortId: string;
    fullName: string;
    email: string | null;
    role: string;
    accountType?: string | null;
    lastActiveShell?: 'PERSONAL' | 'BUSINESS' | null;
  },
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
    lastActiveShell: user.lastActiveShell === 'BUSINESS' ? 'BUSINESS' : 'PERSONAL',
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
  /** Reserve a Pinit ID. No face is stored and no session is issued. */
  async beginEnrollment(): Promise<{ shortId: string; enrollmentToken: string }> {
    const shortId = await mintUniqueShortId();
    return { shortId, enrollmentToken: issueEnrollmentClaim(shortId) };
  },

  /**
   * Replace the enrolled face only when the signed-in user still matches the current template.
   * A stolen session without that face cannot swap the identity.
   */
  async reenrollFace(input: {
    userId: string;
    faceEmbedding: number[];
    padEvidence?: PadEvidence;
    ip?: string;
    userAgent?: string;
  }): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
    const { userId, faceEmbedding, padEvidence, ip, userAgent } = input;
    if (!acceptProbeForActiveEngine(faceEmbedding) || !isValidTemplate(faceEmbedding) || !isFaceProbeQualityOk(faceEmbedding)) {
      return { ok: false, status: 400, message: 'That face sample was not clear enough.' };
    }
    const pad = await verifyPassivePad(padEvidence);
    if (pad.verdict !== 'LIVE') {
      return { ok: false, status: 403, message: padDenyMessage(pad.verdict, pad.reasons) };
    }
    const enrolled = await loadFaceTemplateForUser(userId);
    const verified = verifyClaimedFace({
      claimedUserId: userId,
      probe: normalizeEmbedding(faceEmbedding),
      enrolled,
      threshold: THRESHOLDS.faceLogin,
    });
    if (!verified.ok) {
      await logSecurityEvent('FACE_LOGIN_FAILED', {
        ip, userAgent, success: false, userId,
        detail: { reason: 'reenroll_rejected' },
      });
      return { ok: false, status: 403, message: 'The current face did not match this account.' };
    }
    const faceNorm = normalizeEmbedding(faceEmbedding);
    const faceEnc = encryptTemplate(faceNorm);
    const identity = await prisma.biometricIdentity.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!identity) return { ok: false, status: 404, message: 'No enrolled face on this account.' };
    await prisma.faceTemplate.updateMany({
      where: { biometricIdentityId: identity.id },
      data: {
        templateCipher: faceEnc.cipher,
        templateHash: faceEnc.hash,
        qualityScore: Number.isFinite(pad.scores.sharpness) ? pad.scores.sharpness : null,
      },
    });
    await logSecurityEvent('FACE_LOGIN_SUCCESS', {
      userId, ip, userAgent,
      detail: { reason: 'reenroll' },
    });
    return { ok: true };
  },

  async register(input: BiometricRegisterInput): Promise<
    | { ok: true; user: AuthUser; tokens: AuthTokens; linked?: boolean; message?: string }
    | { ok: false; status: 409; message: string }
  > {
    const {
      faceEmbedding,
      faceSamples,
      enrollmentToken,
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
    const reserved = readEnrollmentClaim(enrollmentToken);

    const samples = (faceSamples ?? []).filter((sample) => Array.isArray(sample.embedding) && sample.embedding.length > 0);
    if (samples.length > 0 && !reserved) {
      throw new AppError(400, 'Reserve a Pinit ID before storing this face.');
    }
    let faceNorm: number[];
    let enrollmentSharpness: number | null = null;
    if (samples.length > 0) {
      const fused = await fuseEnrollmentSamples(samples);
      faceNorm = fused.faceNorm;
      enrollmentSharpness = fused.sharpness;
      logger.info('[Auth:Register] Combined live samples', { count: samples.length });
    } else {
      if (!isValidTemplate(faceEmbedding) || !isFaceProbeQualityOk(faceEmbedding)) {
        throw new AppError(400, 'Invalid or low-quality face embedding. Recapture and try again.');
      }
      const pad = await verifyPassivePad(padEvidence);
      logger.info('[Auth:Register] PAD', { verdict: pad.verdict, reasons: pad.reasons, scores: pad.scores });
      if (pad.verdict !== 'LIVE') {
        await logSecurityEvent('BIOMETRIC_FAILURE', {
          ip, userAgent, success: false,
          detail: { reason: 'pad_failed', verdict: pad.verdict, reasons: pad.reasons },
        });
        throw new AppError(403, padDenyMessage(pad.verdict, pad.reasons), { pad: pad.verdict });
      }
      if (Number.isFinite(pad.scores.sharpness)) enrollmentSharpness = pad.scores.sharpness;
      faceNorm = normalizeEmbedding(faceEmbedding);
    }

    // Passkey (the "fingerprint" step) is a placeholder unless explicitly required.
    // See config.webauthn.requirePasskey — with it off, no credential is demanded
    // or enrolled, and identity rests on face (+ optional voice) alone.
    const passkeyRequired = config.webauthn.requirePasskey;
    if (passkeyRequired || passkeyPendingToken) {
      const pendingOk = assertPendingPasskey(passkeyPendingToken);
      if (!pendingOk.ok) {
        throw new AppError(403, pendingOk.message, { reason: pendingOk.reason });
      }
    } else {
      logger.warn('[Auth:Register] Passkey step is a placeholder — device-possession factor not enforced', {
        hint: 'set WEBAUTHN_REQUIRE_PASSKEY=true to restore real WebAuthn',
      });
    }

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

      // Voice is captured for storage/fusion but no longer blocks registration on
      // its own. voice-fingerprint.ts derives the template from an averaged FFT
      // spectrum, not a trained speaker embedding, so it mostly encodes mic/room
      // acoustics — two different people recorded on the same device can land
      // well inside the duplicate threshold (confirmed in production: 0.0459
      // between two different speakers, see incident 2026-08-19). Face is the
      // proven-reliable signal (real measured separation: 0.137 same person vs
      // 0.375+ different people) and stays the sole uniqueness gate. A voice
      // collision is still logged for visibility, not silently dropped.
      if (voiceNorm) {
        const dupVoice = await findMatchingVoice(voiceNorm, tx);
        if (dupVoice) {
          logger.warn('[Auth:Register] Voice collided with an existing account — not blocking (voice is advisory only)', {
            existingShortId: dupVoice.shortId,
            distance: Number(dupVoice.distance.toFixed(4)),
          });
        }
      }

      if (rawCredentialId && await credentialIdOwnedByOtherUser(rawCredentialId, undefined, tx)) {
        throw new WebAuthnOwnedError();
      }

      const u = await tx.user.create({
        data: {
          shortId,
          fullName: 'PINIT User',
          accountType: resolvedAccountType,
          lastActiveShell: resolvedAccountType === 'BUSINESS' ? 'BUSINESS' : 'PERSONAL',
          organization: resolvedAccountType === 'BUSINESS' && organizationName?.trim()
            ? organizationName.trim()
            : null,
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
          qualityScore: enrollmentSharpness,
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
      // Skipped entirely when the passkey step is a placeholder — nothing fake is
      // ever written to webauthn_credentials.
      let attachedCredentialId: string | undefined;
      if (passkeyRequired || passkeyPendingToken) {
        const attached = await attachPendingPasskey(passkeyPendingToken, u.id, tx);
        if (!attached.ok) {
          throw new PasskeyAttachError(attached.message, attached.reason);
        }
        attachedCredentialId = attached.credentialId;
      }

      return { user: u, attachedCredentialId };
    }, { timeout: 20_000, maxWait: 10_000 });

    let result: Awaited<ReturnType<typeof attempt>> | undefined;
    let lastError: unknown;
    let reservedId = reserved?.shortId ?? null;
    for (let n = 0; n < 2 && !result; n++) {
      try {
        const shortId = reservedId ?? await mintUniqueShortId();
        result = await attempt(shortId);
      } catch (e) {
        lastError = e;
        // shortId collision on insert is astronomically rare (mintUniqueShortId
        // already pre-checks) but the @unique constraint is the real guarantee —
        // retry once with a freshly minted id before giving up.
        if (isShortIdCollision(e) && n === 0) {
          reservedId = null;
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
    if (attachedCredentialId) {
      await logSecurityEvent('WEBAUTHN_REGISTERED', {
        userId: user.id, ip, userAgent,
        detail: { shortId: user.shortId, credentialId: attachedCredentialId },
      });
    }

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

  /**
   * Sign in with a face against a claimed account. Wraps the verification in a
   * failed-attempt throttle (see login-throttle.service.ts): repeated failures for
   * the same claimed ID lock further attempts for a while, so the client-supplied
   * face vector cannot be guessed or iterated indefinitely.
   */
  async login(input: BiometricLoginInput): Promise<
    | { ok: true; user: AuthUser; tokens: AuthTokens; confidence: number; fusion: FusionResult; perf: FaceLoginPerf; claimReplaced: boolean }
    | { ok: false; matched: false; message: string; perf?: FaceLoginPerf }
  > {
    const claim = (input.claimedShortId || input.claimedUserId || '').trim();
    const clientIp = input.ip || 'unknown';

    if (claim) {
      const state = loginThrottle.check(claim, clientIp);
      if (state.locked) {
        await logSecurityEvent('FACE_LOGIN_FAILED', {
          ip: input.ip, userAgent: input.userAgent, success: false,
          detail: { reason: 'throttled', retryAfterSeconds: Math.ceil(state.retryAfterMs / 1000) },
        });
        // Same wording family as every other denial; no distance, no account hint.
        return {
          ok: false as const,
          matched: false as const,
          message: 'Too many unsuccessful attempts. Please wait a few minutes before trying again.',
        };
      }
    }

    const result = await biometricAuthService.loginUnthrottled(input);

    if (claim) {
      if (result.ok) loginThrottle.recordSuccess(claim, clientIp);
      else loginThrottle.recordFailure(claim, clientIp);
    }
    return result;
  },

  async loginUnthrottled(input: BiometricLoginInput): Promise<
    | { ok: true; user: AuthUser; tokens: AuthTokens; confidence: number; fusion: FusionResult; perf: FaceLoginPerf; claimReplaced: boolean }
    | { ok: false; matched: false; message: string; perf?: FaceLoginPerf }
  > {
    const {
      faceEmbedding, voiceFingerprint, deviceFingerprint, ip, userAgent,
      claimedShortId, claimedUserId, padEvidence,
    } = input;
    const lighting = sanitizeLoginLighting(input.lightingTelemetry);
    const t0 = performance.now();
    let padMs = 0;
    let claimMs = 0;
    let decryptMs = 0;
    let matchMs = 0;
    let jwtMs = 0;

    const perfNow = (): FaceLoginPerf => ({
      padMs,
      claimMs,
      decryptMs,
      matchMs,
      jwtMs,
      totalMs: performance.now() - t0,
    });

    const recordHistory = async (opts: {
      userId?: string;
      success: boolean;
      failReason?: string;
      distance?: number | null;
    }) => {
      if (!opts.userId) return;
      await logLoginHistory({
        userId: opts.userId,
        method: 'biometric_login',
        ip,
        userAgent,
        success: opts.success,
        failReason: opts.failReason,
        ambientBrightness: lighting.ambientBrightness,
        lightingStatus: lighting.lightingStatus,
        euclideanDistance: opts.distance ?? null,
        executionTimeMs: performance.now() - t0,
      });
    };

    /** Never carries a similarity distance — a caller must not be able to learn
     * how close a probe was to the enrolled template. */
    const deny = (message: string) => ({
      ok: false as const,
      matched: false as const,
      message,
      perf: perfNow(),
    });
    const denyMsg = 'Could not verify this face for the claimed account.';

    if (!acceptProbeForActiveEngine(faceEmbedding)) {
      await logSecurityEvent('FACE_LOGIN_FAILED', {
        ip, userAgent, success: false,
        detail: { reason: 'MODEL_UNAVAILABLE', decisionCode: BIOMETRIC_DECISION.MODEL_UNAVAILABLE },
      });
      return deny(publicBiometricMessage(BIOMETRIC_DECISION.MODEL_UNAVAILABLE));
    }

    if (!isValidTemplate(faceEmbedding) || !isFaceProbeQualityOk(faceEmbedding)) {
      await logSecurityEvent('FACE_LOGIN_FAILED', {
        ip, userAgent, success: false,
        detail: { reason: 'probe_quality', decisionCode: BIOMETRIC_DECISION.LOW_QUALITY },
      });
      return deny(denyMsg);
    }

    const tPad = performance.now();
    const pad = await verifyPassivePad(padEvidence);
    padMs = performance.now() - tPad;
    logger.info('[Auth:Login] PAD', { verdict: pad.verdict, reasons: pad.reasons, scores: pad.scores, padMs });
    if (pad.verdict !== 'LIVE') {
      await logSecurityEvent('FACE_LOGIN_FAILED', {
        ip, userAgent, success: false,
        detail: {
          reason: 'pad_failed',
          verdict: pad.verdict,
          reasons: pad.reasons,
          decisionCode: BIOMETRIC_DECISION.PAD_FAILED,
        },
      });
      return deny(padDenyMessage(pad.verdict, pad.reasons));
    }

    const tClaim = performance.now();
    let boundUser = await resolveClaimedUser({ claimedShortId, claimedUserId });
    // True when the claimed account does not exist (e.g. a Pinit ID this browser
    // remembers from an account that was deleted) and the account was found by
    // face instead. Liveness has already passed in this request, and a liveness
    // challenge cannot be reused, so the search must happen here, not in a retry.
    let claimReplaced = false;
    if (!boundUser) {
      const found = await findConfidentFaceMatch(normalizeEmbedding(faceEmbedding));
      logger.warn('[Auth:Login] claimed account not found — searched enrolled faces instead', {
        hasShortId: Boolean(claimedShortId?.trim()),
        hasUserId: Boolean(claimedUserId?.trim()),
        found: Boolean(found),
      });
      await logSecurityEvent('FACE_LOGIN_FAILED', {
        ip, userAgent, success: false,
        detail: {
          reason: claimedShortId || claimedUserId ? 'unknown_claim' : 'no_claim',
          fallback: found ? 'face_search_found' : 'face_search_no_match',
        },
      });
      if (!found) {
        claimMs = performance.now() - tClaim;
        return deny(denyMsg);
      }
      boundUser = found;
      claimReplaced = true;
    }
    claimMs = performance.now() - tClaim;

    // Identity is locked to the claim or the verified passkey. Never search the gallery.
    const verifiedUserId = boundUser.id;
    const faceNorm = normalizeEmbedding(faceEmbedding);
    const tDecrypt = performance.now();
    const enrolledFace = await loadFaceTemplateForUser(verifiedUserId);
    decryptMs = performance.now() - tDecrypt;
    const tMatch = performance.now();
    const matchDistance = enrolledFace ? euclideanDistance(faceNorm, enrolledFace) : null;
    const verified = verifyClaimedFace({
      claimedUserId: verifiedUserId,
      probe: faceNorm,
      enrolled: enrolledFace,
      threshold: THRESHOLDS.faceLogin,
    });
    matchMs = performance.now() - tMatch;

    logger.info('[Auth:Login] 1:1 verification (claimed account only)', {
      claimedShortId: boundUser.shortId,
      claimedUserId: verifiedUserId,
      ok: verified.ok,
      reason: verified.ok ? 'match' : verified.reason,
      distance: verified.ok ? Number(verified.distance.toFixed(4)) : null,
      threshold: THRESHOLDS.faceLogin,
      padMs,
      claimMs,
      decryptMs,
      matchMs,
    });

    if (!verified.ok) {
      logger.warn('[Auth:Login] ✗ Authentication result: DENY', {
        claimedShortId: boundUser.shortId,
        reason: verified.reason,
      });
      await logSecurityEvent('FACE_LOGIN_FAILED', {
        ip, userAgent, success: false,
        detail: { reason: `verify_${verified.reason}`, claimedUserId: verifiedUserId, decisionCode: decisionFromClaimedVerify(verified.reason) },
      });
      await recordHistory({
        userId: verifiedUserId,
        success: false,
        failReason: `verify_${verified.reason}`,
        distance: matchDistance,
      });
      return deny(denyMsg);
    }

    const oneToOneDist = verified.distance;
    const probeVoice = voiceFingerprint && isValidTemplate(voiceFingerprint)
      ? normalizeEmbedding(voiceFingerprint)
      : null;

    // Face match is the identity. A passkey is not consulted and cannot block the session.
    const probeFp = deriveFingerprintTemplate(undefined, deviceFingerprint);

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
      claimedShortId: boundUser.shortId,
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
        claimedShortId: boundUser.shortId,
        faceDistance: oneToOneDist.toFixed(4),
        threshold: THRESHOLDS.faceLogin,
      });
      await recordHistory({
        userId: verifiedUserId,
        success: false,
        failReason: 'face_verification_failed',
        distance: oneToOneDist,
      });
      return deny(denyMsg);
    }

    const user = await prisma.user.findUnique({
      where: { id: verifiedUserId, isActive: true },
      select: { id: true, shortId: true, fullName: true, email: true, role: true, accountType: true, lastActiveShell: true },
    });

    if (!user || user.id !== verifiedUserId) {
      return deny(denyMsg);
    }

    if (!mayIssueSession(true, true)) return deny(denyMsg);

    const deviceId = await upsertDevice(user.id, deviceFingerprint);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await prisma.biometricIdentity.updateMany({
      where: { userId: user.id },
      data: { lastVerifiedAt: new Date() },
    });

    const tJwt = performance.now();
    const tokens = createTokens({
      id: user.id,
      shortId: user.shortId,
      fullName: user.fullName,
      role: user.role,
      accountType: user.accountType ?? 'INDIVIDUAL',
      lastActiveShell: user.lastActiveShell,
    });
    await createSession(user.id, tokens.refreshToken, ip, userAgent, deviceId);
    jwtMs = performance.now() - tJwt;

    // Persisted audit carries no similarity distances — fusion.scores holds
    // face/voice/fingerprint distances, which must not land in stored events.
    await logSecurityEvent('FACE_LOGIN_SUCCESS', {
      userId: user.id, ip, userAgent, deviceId,
      detail: { claimedUserId: verifiedUserId, shortId: user.shortId },
    });
    await recordHistory({
      userId: user.id,
      success: true,
      distance: oneToOneDist,
    });

    const perf = perfNow();
    logger.info('[Auth:Perf] Login Metrics', {
      padMs: perf.padMs,
      claimMs: perf.claimMs,
      decryptMs: perf.decryptMs,
      matchMs: perf.matchMs,
      jwtMs: perf.jwtMs,
      totalMs: Number(perf.totalMs.toFixed(2)),
      lightingStatus: lighting.lightingStatus,
      ambientBrightness: lighting.ambientBrightness,
    });
    logger.info('[Auth:Login] ✓ Authentication result: SUCCESS', {
      userId: user.id,
      pinitId: user.shortId,
      jwtSub: user.id,
      confidence: fusion.overallConfidence,
      faceDistance: oneToOneDist.toFixed(4),
      padMs: perf.padMs,
      claimMs: perf.claimMs,
      decryptMs: perf.decryptMs,
      matchMs: perf.matchMs,
      jwtMs: perf.jwtMs,
      totalMs: Number(perf.totalMs.toFixed(2)),
    });

    return {
      ok: true,
      user,
      tokens,
      confidence: fusion.overallConfidence,
      fusion,
      perf,
      claimReplaced,
    };
  },

  /**
   * 1:N sign-in — scan a face, get the account, no Pinit ID typed.
   *
   * login() above is 1:1 on purpose and stays that way: it is the fallback for
   * anyone this refuses. The difference is what a mistake costs. In 1:1 a bad
   * match denies the rightful owner; here it would hand someone another
   * person's vault, so this path only ever resolves an identity it is sure of
   * and otherwise says "not recognized" and stops.
   *
   * Four gates, all of which must pass:
   *   1. probe quality — same check as login
   *   2. liveness (PAD) — same single-use challenge as login, so a photo or a
   *      replayed capture is rejected before any matching happens
   *   3. distance under faceIdentify (0.33), the same ceiling as 1:1 login
   *   4. isIdentifyAccept — nearest must beat the next face by faceIdentifyMargin.
   *      A tie between two people still refuses.
   *
   * Failures are deliberately indistinguishable to the caller: no distance, no
   * "close but not quite", no hint that a given face is enrolled at all.
   */
  async identify(input: {
    faceEmbedding: number[];
    padEvidence?: PadEvidence;
    deviceFingerprint?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<
    | { ok: true; user: AuthUser; tokens: AuthTokens; confidence: number }
    | { ok: false; matched: false; message: string }
  > {
    const { faceEmbedding, padEvidence, deviceFingerprint, ip, userAgent } = input;

    const NOT_RECOGNIZED = 'Face not recognized.';
    const deny = (message = NOT_RECOGNIZED) => ({
      ok: false as const,
      matched: false as const,
      message,
    });

    if (!acceptProbeForActiveEngine(faceEmbedding) || !isValidTemplate(faceEmbedding) || !isFaceProbeQualityOk(faceEmbedding)) {
      await logSecurityEvent('FACE_IDENTIFY_FAILED', {
        ip, userAgent, success: false,
        detail: { reason: 'probe_quality' },
      });
      return deny();
    }

    // Liveness first — never match against the gallery on unproven input.
    const pad = await verifyPassivePad(padEvidence);
    logger.info('[Auth:Identify] PAD', { verdict: pad.verdict, reasons: pad.reasons });
    if (pad.verdict !== 'LIVE') {
      await logSecurityEvent('FACE_IDENTIFY_FAILED', {
        ip, userAgent, success: false,
        detail: { reason: 'pad_failed', verdict: pad.verdict, reasons: pad.reasons },
      });
      return deny(padDenyMessage(pad.verdict, pad.reasons));
    }

    const probe = normalizeEmbedding(faceEmbedding);
    const gallery = await loadAllFaceTemplates(prisma, { activeOnly: true });
    const { best, secondDistance } = searchFaceGallery(probe, gallery);

    const threshold = MATCH_THRESHOLDS.faceIdentify;
    const confident = Boolean(best) && isIdentifyAccept(best!.distance, secondDistance, threshold);

    logger.info('[Auth:Identify] 1:N gallery search', {
      gallerySize: gallery.length,
      nearestShortId: best?.shortId ?? null,
      nearestDistance: best ? Number(best.distance.toFixed(4)) : null,
      secondDistance: Number.isFinite(secondDistance) ? Number(secondDistance.toFixed(4)) : null,
      margin: MATCH_THRESHOLDS.faceIdentifyMargin,
      threshold,
      confident,
    });

    if (!best || !confident) {
      traceBiometric('match=FAIL', { reason: !best ? 'NO_MATCH' : 'AMBIGUOUS_OR_NO_MATCH', gallerySize: gallery.length });
      await logSecurityEvent('FACE_IDENTIFY_FAILED', {
        ip, userAgent, success: false,
        detail: {
          reason: !best ? 'empty_gallery' : 'no_confident_match',
          gallerySize: gallery.length,
        },
      });
      return deny();
    }

    const user = await prisma.user.findUnique({
      where: { id: best.userId, isActive: true },
      select: { id: true, shortId: true, fullName: true, email: true, role: true, accountType: true, lastActiveShell: true },
    });
    if (!user) return deny();

    if (!mayIssueSession(true, true)) return deny();

    const deviceId = await upsertDevice(user.id, deviceFingerprint);
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
      lastActiveShell: user.lastActiveShell,
    });
    await createSession(user.id, tokens.refreshToken, ip, userAgent, deviceId);

    // No distances persisted — an audit trail must not become a way to measure
    // how close a probe was to an enrolled template.
    traceBiometric('match=PASS', { authentication: 'SUCCESS' });
    await logSecurityEvent('FACE_IDENTIFY_SUCCESS', {
      userId: user.id, ip, userAgent, deviceId,
      detail: { shortId: user.shortId, gallerySize: gallery.length },
    });
    await logLoginHistory({ userId: user.id, method: 'biometric_identify', ip, userAgent, success: true });

    logger.info('[Auth:Identify] ✓ Identified', {
      userId: user.id,
      pinitId: user.shortId,
      distance: best.distance.toFixed(4),
    });

    return {
      ok: true,
      user,
      tokens,
      confidence: Math.round(Math.max(0, 1 - best.distance / threshold) * 100),
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
        lastActiveShell: resolved === 'BUSINESS' ? 'BUSINESS' : 'PERSONAL',
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
      select: { id: true, shortId: true, fullName: true, role: true, accountType: true, lastActiveShell: true },
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
      lastActiveShell: user.lastActiveShell,
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
