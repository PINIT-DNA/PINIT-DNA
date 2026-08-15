/**
 * WebAuthn / passkey registration and assertion.
 * Pinit never receives fingerprint or platform biometric templates —
 * only a cryptographic attestation or assertion.
 */
import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { toRootPinitId } from '../../lib/pinit-identity';
import {
  checkChallengeFreshness,
  checkClientData,
  checkCredentialOwnership,
  checkRpId,
  checkSignCount,
  gatePendingPasskeyEnroll,
  isSimulatedCredentialId,
} from './webauthn-evaluate';
import {
  countWebAuthnByUserId,
  findWebAuthnByCredentialId,
  insertWebAuthnCredential,
  listWebAuthnByUserId,
  updateWebAuthnSignCount,
} from './webauthn-store';

const HMAC_KEY = crypto.createHash('sha256').update(`webauthn:${config.jwt.secret}`).digest();
/** Allow Windows Hello prompt + wizard steps without expiring mid-flow. */
const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 10 * 60_000;

type ChallengeKind = 'register' | 'login';

interface StoredChallenge {
  v: 1;
  kind: ChallengeKind;
  jti: string;
  challenge: string;
  origin: string;
  rpID: string;
  claimedUserId?: string;
  iat: number;
  exp: number;
}

interface PendingPasskey {
  v: 1;
  jti: string;
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports?: string[];
  /** When set, attach is only allowed for this userId */
  intendedUserId?: string;
  iat: number;
  exp: number;
}

interface WebAuthnSession {
  v: 1;
  jti: string;
  userId: string;
  credentialId: string;
  iat: number;
  exp: number;
}

const usedJti = new Map<string, number>();
const liveChallenges = new Map<string, StoredChallenge>();

function b64urlJson(obj: object): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function signBlob(body: string): string {
  const mac = crypto.createHmac('sha256', HMAC_KEY).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function openSigned<T>(token: string | undefined | null): T | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = crypto.createHmac('sha256', HMAC_KEY).update(parts[0]).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function markUsed(jti: string): void {
  usedJti.set(jti, Date.now() + 15 * 60 * 1000);
  if (usedJti.size > 4000) {
    const now = Date.now();
    for (const [k, exp] of usedJti) if (exp < now) usedJti.delete(k);
  }
}

function alreadyUsed(jti: string): boolean {
  const exp = usedJti.get(jti);
  return Boolean(exp && exp > Date.now());
}

export function resolveWebAuthnRp(originHeader?: string): { origin: string; rpID: string } {
  const fallback = { origin: config.webauthn.origin, rpID: config.webauthn.rpID };
  if (!originHeader) return fallback;
  try {
    const url = new URL(originHeader);
    const host = url.hostname;
    const allowed =
      host === 'localhost'
      || host === '127.0.0.1'
      || host.endsWith('.vercel.app')
      || host.endsWith('.pinithub.com')
      || host === 'pinithub.com'
      || host === config.webauthn.rpID
      || originHeader === config.webauthn.origin;
    if (!allowed) return fallback;
    return { origin: originHeader, rpID: host };
  } catch {
    return fallback;
  }
}

function deny(message: string, reason: string) {
  return { ok: false as const, message, reason };
}

async function loadUserByClaim(claimedShortId?: string, claimedUserId?: string): Promise<{ id: string; shortId: string } | null> {
  const id = claimedUserId?.trim();
  const raw = claimedShortId?.trim();
  if (!id && !raw) return null;
  const shorts = new Set<string>();
  if (raw) {
    shorts.add(raw.toUpperCase());
    const root = toRootPinitId(raw);
    if (root) shorts.add(root);
  }
  const or: Array<{ id: string } | { shortId: string }> = [];
  if (id && /^[0-9a-f-]{36}$/i.test(id)) or.push({ id });
  for (const s of shorts) or.push({ shortId: s });
  if (!or.length) return null;
  return prisma.user.findFirst({
    where: { isActive: true, OR: or },
    select: { id: true, shortId: true },
  });
}

export async function startPasskeyRegistration(opts: {
  originHeader?: string;
  userId?: string;
  userName?: string;
}): Promise<{ ok: true; registrationId: string; options: Awaited<ReturnType<typeof generateRegistrationOptions>> } | { ok: false; message: string; reason: string }> {
  const rp = resolveWebAuthnRp(opts.originHeader);
  const userName = opts.userName || opts.userId || 'pinit-user';
  const exclude = opts.userId
    ? (await listWebAuthnByUserId(opts.userId)).map((c) => ({
        id: c.credentialId,
        transports: c.transports as 'internal'[],
      }))
    : [];

  const options = await generateRegistrationOptions({
    rpName: config.webauthn.rpName,
    rpID: rp.rpID,
    userName,
    userID: new TextEncoder().encode(opts.userId || crypto.randomUUID()),
    userDisplayName: userName,
    attestationType: 'none',
    excludeCredentials: exclude,
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred',
    },
    timeout: CHALLENGE_TTL_MS,
  });

  const now = Date.now();
  const stored: StoredChallenge = {
    v: 1,
    kind: 'register',
    jti: crypto.randomUUID(),
    challenge: options.challenge,
    origin: rp.origin,
    rpID: rp.rpID,
    claimedUserId: opts.userId,
    iat: now,
    exp: now + CHALLENGE_TTL_MS,
  };
  liveChallenges.set(stored.jti, stored);
  return { ok: true, registrationId: stored.jti, options };
}

export async function finishPasskeyRegistration(opts: {
  registrationId: string;
  credential: RegistrationResponseJSON;
  originHeader?: string;
  bindUserId?: string;
}): Promise<
  | { ok: true; pendingToken?: string; credentialId: string; userId?: string }
  | { ok: false; message: string; reason: string }
> {
  const stored = liveChallenges.get(opts.registrationId);
  liveChallenges.delete(opts.registrationId);
  const fresh = checkChallengeFreshness({ expiresAt: stored?.exp ?? 0, used: alreadyUsed(opts.registrationId) });
  if (!stored || stored.kind !== 'register' || !fresh.ok) {
    return deny('Passkey registration challenge is invalid or expired. Retry.', fresh.ok ? 'invalid_challenge' : fresh.reason);
  }
  markUsed(stored.jti);

  const cd = checkClientData({
    clientDataJSON: opts.credential.response.clientDataJSON,
    expectedType: 'webauthn.create',
    expectedChallenge: stored.challenge,
    expectedOrigin: stored.origin,
  });
  if (!cd.ok) {
    return deny('Passkey origin or challenge did not match.', cd.reason);
  }

  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: opts.credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: stored.origin,
      expectedRPID: stored.rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    logger.warn('[WebAuthn] registration verify threw', { error: String(err) });
    return deny('Passkey registration could not be verified.', 'verify_failed');
  }
  if (!verified.verified || !verified.registrationInfo) {
    return deny('Passkey registration could not be verified.', 'verify_failed');
  }

  const cred = verified.registrationInfo.credential;
  const credentialId = cred.id;
  if (isSimulatedCredentialId(credentialId)) {
    return deny('Simulated device hashes are not accepted as passkeys.', 'simulated');
  }
  const publicKey = Buffer.from(cred.publicKey).toString('base64');
  const signCount = cred.counter ?? 0;
  const transports = opts.credential.response.transports ?? [];

  const existing = await findWebAuthnByCredentialId(credentialId);
  if (existing) {
    return deny('This authenticator is already registered to a Pinit account.', 'credential_taken');
  }

  const bindUserId = opts.bindUserId || stored.claimedUserId;
  if (bindUserId) {
    await insertWebAuthnCredential({
      credentialId,
      publicKey,
      userId: bindUserId,
      signCount,
      transports,
      deviceType: verified.registrationInfo.credentialDeviceType,
      backedUp: verified.registrationInfo.credentialBackedUp,
    });
    await prisma.user.update({
      where: { id: bindUserId },
      data: { webauthnCredentialId: credentialId },
    }).catch(() => undefined);
    return { ok: true, credentialId, userId: bindUserId };
  }

  const pending: PendingPasskey = {
    v: 1,
    jti: crypto.randomUUID(),
    credentialId,
    publicKey,
    signCount,
    transports,
    intendedUserId: stored.claimedUserId,
    iat: Date.now(),
    exp: Date.now() + 10 * 60 * 1000,
  };
  return { ok: true, credentialId, pendingToken: signBlob(b64urlJson(pending)) };
}

/** Test / internal helper — mint a signed pending enrollment token. */
export function mintPendingPasskeyToken(params: {
  credentialId: string;
  publicKey?: string;
  signCount?: number;
  transports?: string[];
  intendedUserId?: string;
  ttlMs?: number;
  jti?: string;
  iat?: number;
}): string {
  const now = params.iat ?? Date.now();
  const pending: PendingPasskey = {
    v: 1,
    jti: params.jti ?? crypto.randomUUID(),
    credentialId: params.credentialId,
    publicKey: params.publicKey ?? Buffer.from('test-public-key').toString('base64'),
    signCount: params.signCount ?? 0,
    transports: params.transports ?? [],
    intendedUserId: params.intendedUserId,
    iat: now,
    exp: now + (params.ttlMs ?? 10 * 60 * 1000),
  };
  return signBlob(b64urlJson(pending));
}

export async function startPasskeyLogin(opts: {
  originHeader?: string;
  claimedShortId?: string;
  claimedUserId?: string;
}): Promise<
  | { ok: true; loginId: string; options: Awaited<ReturnType<typeof generateAuthenticationOptions>>; claimedUserId?: string }
  | { ok: false; message: string; reason: string }
> {
  const rp = resolveWebAuthnRp(opts.originHeader);
  const claimed = await loadUserByClaim(opts.claimedShortId, opts.claimedUserId);
  const allow = claimed
    ? (await listWebAuthnByUserId(claimed.id)).map((c) => ({
        id: c.credentialId,
        transports: c.transports as 'internal'[],
      }))
    : [];

  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: allow.length ? allow : undefined,
    userVerification: 'required',
    timeout: CHALLENGE_TTL_MS,
  });

  const now = Date.now();
  const stored: StoredChallenge = {
    v: 1,
    kind: 'login',
    jti: crypto.randomUUID(),
    challenge: options.challenge,
    origin: rp.origin,
    rpID: rp.rpID,
    claimedUserId: claimed?.id,
    iat: now,
    exp: now + CHALLENGE_TTL_MS,
  };
  liveChallenges.set(stored.jti, stored);
  return { ok: true, loginId: stored.jti, options, claimedUserId: claimed?.id };
}

export async function finishPasskeyLogin(opts: {
  loginId: string;
  credential: AuthenticationResponseJSON;
}): Promise<
  | { ok: true; webauthnSession: string; userId: string; credentialId: string }
  | { ok: false; message: string; reason: string }
> {
  const stored = liveChallenges.get(opts.loginId);
  liveChallenges.delete(opts.loginId);
  const fresh = checkChallengeFreshness({ expiresAt: stored?.exp ?? 0, used: alreadyUsed(opts.loginId) });
  if (!stored || stored.kind !== 'login' || !fresh.ok) {
    return deny('Passkey login challenge is invalid or expired. Retry.', fresh.ok ? 'invalid_challenge' : fresh.reason);
  }
  markUsed(stored.jti);

  const cd = checkClientData({
    clientDataJSON: opts.credential.response.clientDataJSON,
    expectedType: 'webauthn.get',
    expectedChallenge: stored.challenge,
    expectedOrigin: stored.origin,
  });
  if (!cd.ok) {
    return deny('Passkey origin or challenge did not match.', cd.reason);
  }

  const rp = checkRpId(opts.credential.response.authenticatorData, stored.rpID);
  if (!rp.ok) {
    return deny('Passkey RP ID did not match.', rp.reason);
  }

  const credentialId = opts.credential.id;
  if (isSimulatedCredentialId(credentialId)) {
    return deny('Simulated device hashes are not accepted as passkeys.', 'simulated');
  }

  const row = await findWebAuthnByCredentialId(credentialId);
  if (!row) {
    return deny('Unknown passkey. Use the authenticator registered to this Pinit account.', 'invalid_credential');
  }

  const owner = checkCredentialOwnership({
    claimedUserId: stored.claimedUserId || row.userId,
    credentialUserId: row.userId,
  });
  if (!owner.ok || (stored.claimedUserId && stored.claimedUserId !== row.userId)) {
    logger.warn('[WebAuthn] ownership deny', { claimed: stored.claimedUserId, owner: row.userId });
    return deny('This passkey belongs to a different Pinit account.', 'mismatch');
  }

  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response: opts.credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: stored.origin,
      expectedRPID: stored.rpID,
      requireUserVerification: true,
      credential: {
        id: row.credentialId,
        publicKey: Buffer.from(row.publicKey, 'base64'),
        counter: row.signCount,
      },
    });
  } catch (err) {
    logger.warn('[WebAuthn] assertion verify threw', { error: String(err) });
    return deny('Passkey assertion could not be verified.', 'verify_failed');
  }
  if (!verified.verified) {
    return deny('Passkey assertion could not be verified.', 'verify_failed');
  }

  const incomingCount = verified.authenticationInfo.newCounter;
  const counter = checkSignCount(row.signCount, incomingCount);
  if (!counter.ok) {
    return deny('Passkey assertion was replayed.', counter.reason);
  }

  await updateWebAuthnSignCount(credentialId, incomingCount);

  return {
    ok: true,
    webauthnSession: issueWebAuthnSession({ userId: row.userId, credentialId }),
    userId: row.userId,
    credentialId,
  };
}

/** Signed proof that a passkey was verified. Not a login JWT. */
export function issueWebAuthnSession(params: {
  userId: string;
  credentialId: string;
  ttlMs?: number;
  jti?: string;
}): string {
  const now = Date.now();
  const session: WebAuthnSession = {
    v: 1,
    jti: params.jti ?? crypto.randomUUID(),
    userId: params.userId,
    credentialId: params.credentialId,
    iat: now,
    exp: now + (params.ttlMs ?? SESSION_TTL_MS),
  };
  return signBlob(b64urlJson(session));
}

export function consumeWebAuthnSession(token: string | undefined, claimedUserId: string): {
  ok: true;
  userId: string;
  credentialId: string;
} | { ok: false; reason: string; message: string } {
  const session = openSigned<WebAuthnSession>(token);
  if (!session || session.v !== 1 || !session.userId) {
    return deny('Device passkey verification is required.', 'no_session');
  }
  const fresh = checkChallengeFreshness({ expiresAt: session.exp, used: alreadyUsed(session.jti) });
  if (!fresh.ok) {
    return deny('Passkey session expired. Verify this device again.', fresh.reason);
  }
  const owner = checkCredentialOwnership({ claimedUserId, credentialUserId: session.userId });
  if (!owner.ok) {
    return deny('This passkey belongs to a different Pinit account.', owner.reason);
  }
  markUsed(session.jti);
  return { ok: true, userId: session.userId, credentialId: session.credentialId };
}

export function assertPendingPasskey(pendingToken: string | undefined): { ok: true } | { ok: false; message: string; reason: string } {
  const pending = openSigned<PendingPasskey>(pendingToken);
  if (!pending || pending.v !== 1 || !pending.credentialId) {
    return deny('Passkey enrollment is required.', 'no_pending');
  }
  const fresh = checkChallengeFreshness({ expiresAt: pending.exp, used: alreadyUsed(pending.jti) });
  if (!fresh.ok) {
    return deny('Passkey enrollment expired. Verify this device again.', fresh.reason);
  }
  if (isSimulatedCredentialId(pending.credentialId)) {
    return deny('Simulated device hashes are not accepted as passkeys.', 'simulated');
  }
  return { ok: true };
}

export async function attachPendingPasskey(pendingToken: string | undefined, userId: string): Promise<
  { ok: true; credentialId: string } | { ok: false; message: string; reason: string }
> {
  const pending = openSigned<PendingPasskey>(pendingToken);
  if (!pending || pending.v !== 1 || !pending.credentialId) {
    return deny('Passkey enrollment is required.', 'no_pending');
  }
  const fresh = checkChallengeFreshness({ expiresAt: pending.exp, used: alreadyUsed(pending.jti) });
  if (!fresh.ok) {
    return deny('Passkey enrollment expired. Verify this device again.', fresh.reason);
  }
  if (isSimulatedCredentialId(pending.credentialId)) {
    return deny('Simulated device hashes are not accepted as passkeys.', 'simulated');
  }
  const existing = await findWebAuthnByCredentialId(pending.credentialId);
  const existingCount = await countWebAuthnByUserId(userId);
  const gate = gatePendingPasskeyEnroll({
    targetUserId: userId,
    existingPasskeyCount: existingCount,
    pendingCredentialOwnerId: existing?.userId ?? null,
    intendedUserId: pending.intendedUserId ?? null,
  });
  if (!gate.ok) {
    if (gate.reason === 'existing_passkey_required') {
      return deny(
        'This account already has a passkey. Verify with the authenticator registered to this Pinit account.',
        gate.reason,
      );
    }
    return deny('This passkey belongs to a different Pinit account.', gate.reason);
  }
  markUsed(pending.jti);
  if (!existing) {
    await insertWebAuthnCredential({
      credentialId: pending.credentialId,
      publicKey: pending.publicKey,
      userId,
      signCount: pending.signCount,
      transports: pending.transports ?? [],
    });
  }
  await prisma.user.update({
    where: { id: userId },
    data: { webauthnCredentialId: pending.credentialId },
  }).catch(() => undefined);
  return { ok: true, credentialId: pending.credentialId };
}

export async function userHasPasskeys(userId: string): Promise<boolean> {
  const n = await countWebAuthnByUserId(userId);
  return n > 0;
}

export { isSimulatedCredentialId };
