/**
 * Reserves a Pinit ID before any face is stored.
 * The face enrolls onto this claim. It does not choose an account.
 * No session is issued here.
 */
import crypto from 'crypto';
import { config } from '../../config';

const TTL_MS = 30 * 60 * 1000;

export interface EnrollmentClaim {
  shortId: string;
  exp: number;
}

function secret(): string {
  return config.jwt.secret || 'pinit-enrollment';
}

export function issueEnrollmentClaim(shortId: string, now = Date.now()): string {
  const body: EnrollmentClaim = { shortId, exp: now + TTL_MS };
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function readEnrollmentClaim(token: string | undefined | null, now = Date.now()): EnrollmentClaim | null {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as EnrollmentClaim;
    if (!parsed.shortId?.startsWith('PINIT-') || !Number.isFinite(parsed.exp) || parsed.exp < now) return null;
    return parsed;
  } catch {
    return null;
  }
}
