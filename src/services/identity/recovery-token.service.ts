/**
 * Vault-store recovery token — enables identity recovery after transforms.
 */
import crypto from 'crypto';
import { config } from '../../config';

export const RECOVERY_TOKEN_PREFIX = 'PINIT-RVT';
export const RECOVERY_TOKEN_VERSION = 1;

export interface RecoveryTokenPayload {
  v: number;
  vaultId: string;
  dnaRecordId: string;
  ownerUserId: string;
  certificateId: string | null;
  issuedAt: string;
  manifestHash: string;
}

function signingSecret(): string {
  return process.env.PHASE3_SIGNING_SECRET ?? config.vault.masterSecret ?? 'pinit-recovery-dev';
}

export function issueRecoveryToken(context: {
  vaultId: string;
  dnaRecordId: string;
  ownerUserId: string;
  certificateId: string | null;
  manifestHash: string;
}): string {
  const payload: RecoveryTokenPayload = {
    v: RECOVERY_TOKEN_VERSION,
    vaultId: context.vaultId,
    dnaRecordId: context.dnaRecordId,
    ownerUserId: context.ownerUserId,
    certificateId: context.certificateId,
    issuedAt: new Date().toISOString(),
    manifestHash: context.manifestHash,
  };

  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', signingSecret())
    .update(body)
    .digest('base64url');

  return `${RECOVERY_TOKEN_PREFIX}|${body}|${sig}`;
}

export function verifyRecoveryToken(raw: string): {
  valid: boolean;
  payload?: RecoveryTokenPayload;
  detail: string;
} {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(RECOVERY_TOKEN_PREFIX)) {
    return { valid: false, detail: 'Missing recovery token prefix' };
  }

  const parts = trimmed.split('|');
  if (parts.length < 3) {
    return { valid: false, detail: 'Malformed recovery token' };
  }

  const body = parts[1]!;
  const sig = parts[2]!;
  const expected = crypto
    .createHmac('sha256', signingSecret())
    .update(body)
    .digest('base64url');

  if (sig !== expected) {
    return { valid: false, detail: 'Recovery token HMAC invalid' };
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as RecoveryTokenPayload;
    if (payload.v !== RECOVERY_TOKEN_VERSION) {
      return { valid: false, detail: `Unsupported recovery token version ${payload.v}` };
    }
    return { valid: true, payload, detail: 'Recovery token verified' };
  } catch {
    return { valid: false, detail: 'Recovery token JSON invalid' };
  }
}

export function recoveryTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
