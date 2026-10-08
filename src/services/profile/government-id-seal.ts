/**
 * Short-lived proof that the signed-in user just matched their enrolled face.
 * It authorizes storing one government document. It is not a session token.
 */
import crypto from 'crypto';
import { config } from '../../config';

const TTL_MS = 10 * 60 * 1000;

export interface GovernmentIdSeal {
  userId: string;
  biometricIdentityId: string;
  purpose: 'government_id_seal';
  exp: number;
}

function secret(): string {
  return config.jwt.secret || 'pinit-government-id';
}

export function issueGovernmentIdSeal(userId: string, biometricIdentityId: string, now = Date.now()): string {
  const body: GovernmentIdSeal = {
    userId,
    biometricIdentityId,
    purpose: 'government_id_seal',
    exp: now + TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function readGovernmentIdSeal(token: string | undefined | null, now = Date.now()): GovernmentIdSeal | null {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as GovernmentIdSeal;
    if (parsed.purpose !== 'government_id_seal') return null;
    if (!parsed.userId || !parsed.biometricIdentityId) return null;
    if (!Number.isFinite(parsed.exp) || parsed.exp < now) return null;
    return parsed;
  } catch {
    return null;
  }
}
