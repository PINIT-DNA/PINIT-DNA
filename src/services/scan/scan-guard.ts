import crypto from 'crypto';
import { dnaVnextConfig } from '../../config/dna-vnext';

const MIN_AGE_MS = 800;
const MAX_AGE_MS = 10 * 60 * 1000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_SCANS = 8;

const hits = new Map<string, number[]>();

function sign(issuedAt: string): string {
  return crypto.createHmac('sha256', dnaVnextConfig.secret).update(`pinit-scan-v1:${issuedAt}`).digest('hex');
}

export function issueScanChallenge(now = Date.now()): { token: string } {
  const issuedAt = String(now);
  return { token: `${issuedAt}.${sign(issuedAt)}` };
}

export function checkScanChallenge(token: string, honeypot: string, now = Date.now()): boolean {
  if (honeypot.trim()) return false;
  const [issuedAt, mac] = token.split('.');
  if (!issuedAt || !mac) return false;
  const expect = sign(issuedAt);
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const age = now - Number(issuedAt);
  return Number.isFinite(age) && age >= MIN_AGE_MS && age <= MAX_AGE_MS;
}

export function consumeScanAttempt(key: string, now = Date.now()): boolean {
  const prev = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (prev.length >= MAX_SCANS) {
    hits.set(key, prev);
    return false;
  }
  prev.push(now);
  hits.set(key, prev);
  return true;
}

export function resetScanAttempts(): void {
  hits.clear();
  details.clear();
}

const DETAILS_TTL_MS = 30 * 60 * 1000;
const DETAILS_MAX = 500;
const details = new Map<string, { dnaRecordId: string; verdict: 'protected' | 'possible'; exp: number }>();

/** Opaque handle for the public details page. It is not an asset id. */
export function issuePublicDetailToken(
  dnaRecordId: string,
  verdict: 'protected' | 'possible',
  now = Date.now(),
): string {
  if (details.size >= DETAILS_MAX) {
    const oldest = details.keys().next().value;
    if (oldest) details.delete(oldest);
  }
  const token = crypto.randomBytes(24).toString('base64url');
  details.set(token, { dnaRecordId, verdict, exp: now + DETAILS_TTL_MS });
  return token;
}

export function readPublicDetailToken(token: string, now = Date.now()): { dnaRecordId: string; verdict: 'protected' | 'possible' } | null {
  const row = details.get(token);
  if (!row) return null;
  if (row.exp <= now) {
    details.delete(token);
    return null;
  }
  return { dnaRecordId: row.dnaRecordId, verdict: row.verdict };
}
