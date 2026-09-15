/**
 * Pure WebAuthn policy checks — ownership, clientData, RP ID, counter, challenge.
 * Signature verification is performed by @simplewebauthn/server; these gates
 * run first and are unit-tested without an authenticator.
 */
import crypto from 'crypto';

export function isSimulatedCredentialId(id?: string | null): boolean {
  if (!id) return true;
  return id.startsWith('sim_') || id.startsWith('dev_');
}

export function checkCredentialOwnership(params: {
  claimedUserId: string;
  credentialUserId: string | null | undefined;
}): { ok: true } | { ok: false; reason: 'no_credential' | 'mismatch' } {
  const claimed = params.claimedUserId.trim();
  const owner = (params.credentialUserId ?? '').trim();
  if (!claimed) return { ok: false, reason: 'no_credential' };
  if (!owner) return { ok: false, reason: 'no_credential' };
  if (claimed !== owner) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

export function parseClientDataJSON(clientDataJSON: string): {
  type?: string;
  origin?: string;
  challenge?: string;
} | null {
  try {
    const raw = Buffer.from(clientDataJSON, 'base64url').toString('utf8');
    return JSON.parse(raw) as { type?: string; origin?: string; challenge?: string };
  } catch {
    try {
      return JSON.parse(clientDataJSON) as { type?: string; origin?: string; challenge?: string };
    } catch {
      return null;
    }
  }
}

export function checkClientData(params: {
  clientDataJSON: string;
  expectedType: 'webauthn.create' | 'webauthn.get';
  expectedChallenge: string;
  expectedOrigin: string | string[];
}): { ok: true } | { ok: false; reason: 'client_data' | 'wrong_type' | 'wrong_origin' | 'wrong_challenge' } {
  const data = parseClientDataJSON(params.clientDataJSON);
  if (!data) return { ok: false, reason: 'client_data' };
  if (data.type !== params.expectedType) return { ok: false, reason: 'wrong_type' };
  const origins = Array.isArray(params.expectedOrigin) ? params.expectedOrigin : [params.expectedOrigin];
  if (!data.origin || !origins.includes(data.origin)) return { ok: false, reason: 'wrong_origin' };
  if (!data.challenge || data.challenge !== params.expectedChallenge) {
    return { ok: false, reason: 'wrong_challenge' };
  }
  return { ok: true };
}

export function checkRpId(authenticatorDataB64: string, expectedRpId: string | string[]): {
  ok: true;
} | { ok: false; reason: 'auth_data' | 'wrong_rp_id' } {
  let buf: Buffer;
  try {
    buf = Buffer.from(authenticatorDataB64, 'base64url');
  } catch {
    return { ok: false, reason: 'auth_data' };
  }
  if (buf.length < 32) return { ok: false, reason: 'auth_data' };
  const ids = Array.isArray(expectedRpId) ? expectedRpId : [expectedRpId];
  const rpHash = buf.subarray(0, 32);
  for (const id of ids) {
    const expected = crypto.createHash('sha256').update(id).digest();
    if (rpHash.equals(expected)) return { ok: true };
  }
  return { ok: false, reason: 'wrong_rp_id' };
}

export function checkSignCount(stored: number, incoming: number): { ok: true } | { ok: false; reason: 'replay_counter' } {
  if (!Number.isFinite(stored) || !Number.isFinite(incoming) || incoming < 0 || stored < 0) {
    return { ok: false, reason: 'replay_counter' };
  }
  if (incoming === 0 && stored === 0) return { ok: true };
  if (incoming <= stored) return { ok: false, reason: 'replay_counter' };
  return { ok: true };
}

export function checkChallengeFreshness(params: {
  expiresAt: number;
  used?: boolean;
  now?: number;
}): { ok: true } | { ok: false; reason: 'expired_challenge' | 'replayed_assertion' } {
  const now = params.now ?? Date.now();
  if (params.used) return { ok: false, reason: 'replayed_assertion' };
  if (now > params.expiresAt) return { ok: false, reason: 'expired_challenge' };
  return { ok: true };
}

/**
 * Face + PAD must not enroll a new passkey when the account already has one.
 * Pending enrollment must only bind to the verified user (never A→B).
 */
export function gatePendingPasskeyEnroll(params: {
  targetUserId: string;
  existingPasskeyCount: number;
  /** Credential already in store, if any */
  pendingCredentialOwnerId?: string | null;
  /** Intended owner stamped into the pending token (optional) */
  intendedUserId?: string | null;
}): { ok: true } | { ok: false; reason: 'existing_passkey_required' | 'mismatch' | 'no_user' } {
  const target = params.targetUserId.trim();
  if (!target) return { ok: false, reason: 'no_user' };

  const intended = (params.intendedUserId ?? '').trim();
  if (intended && intended !== target) {
    return { ok: false, reason: 'mismatch' };
  }

  const owner = (params.pendingCredentialOwnerId ?? '').trim();
  if (owner && owner !== target) {
    return { ok: false, reason: 'mismatch' };
  }

  // Idempotent re-attach of a credential already owned by the target is allowed.
  const alreadyOwnedByTarget = Boolean(owner && owner === target);
  if (params.existingPasskeyCount > 0 && !alreadyOwnedByTarget) {
    return { ok: false, reason: 'existing_passkey_required' };
  }

  return { ok: true };
}

/**
 * Login passkey path after face + PAD succeeded for the claimed user.
 * Existing authenticator (webauthnSession) always wins; pending enroll only if count === 0.
 */
export function decideLoginPasskeyPath(params: {
  hasWebauthnSession: boolean;
  hasPendingToken: boolean;
  existingPasskeyCount: number;
}):
  | { action: 'consume_session' }
  | { action: 'enroll_pending' }
  | { action: 'deny'; reason: 'existing_passkey_required' | 'passkey_required' | 'enroll_required' } {
  if (params.hasWebauthnSession) return { action: 'consume_session' };
  if (params.hasPendingToken) {
    if (params.existingPasskeyCount > 0) {
      return { action: 'deny', reason: 'existing_passkey_required' };
    }
    return { action: 'enroll_pending' };
  }
  if (params.existingPasskeyCount > 0) {
    return { action: 'deny', reason: 'passkey_required' };
  }
  return { action: 'deny', reason: 'enroll_required' };
}
