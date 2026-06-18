/**
 * PINIT — Human Origin Identity (HOID) local state
 *
 * The HOID + its bound device shortId live on-device. Their presence is what
 * decides whether app launch routes to the Registration flow (first-time) or
 * the Login flow (returning user). The actual session/JWT is still issued by
 * the backend via AuthContext — HOID is the device-side identity envelope.
 */

const K_HOID         = 'pinit_hoid';
const K_SHORT_ID     = 'pinit_hoid_shortid';
const K_TRUST        = 'pinit_trust_score';
const K_LAST_LOGIN   = 'pinit_last_login';
const K_REGISTERED   = 'pinit_registered_at';
const K_DEVICE_FP    = 'pinit_device_fp';

export interface HoidRecord {
  hoid: string;
  shortId: string;
  trustScore: number;
  registeredAt: string;
  lastLogin: string | null;
  deviceFp: string | null;
}

/** A registered device has both an HOID and the backend shortId bound to it. */
export function isDeviceRegistered(): boolean {
  return Boolean(localStorage.getItem(K_HOID) && localStorage.getItem(K_SHORT_ID));
}

/** Generate a fresh HOID, optionally seeded by the device fingerprint hash. */
export function generateHoid(deviceFp?: string): string {
  const seed = (deviceFp ?? '').replace(/[^a-f0-9]/gi, '').toUpperCase();
  const rand = () =>
    Math.floor(crypto.getRandomValues(new Uint32Array(1))[0]).toString(36).toUpperCase().padStart(4, '0').slice(0, 4);
  const block = (i: number) => (seed.slice(i * 4, i * 4 + 4) || rand()).padEnd(4, rand()).slice(0, 4);
  return `HOID-${block(0)}-${block(1)}-${rand()}`;
}

export function saveRegistration(rec: {
  hoid: string;
  shortId: string;
  trustScore?: number;
  deviceFp?: string;
}): void {
  localStorage.setItem(K_HOID, rec.hoid);
  localStorage.setItem(K_SHORT_ID, rec.shortId);
  localStorage.setItem(K_TRUST, String(rec.trustScore ?? 99.8));
  localStorage.setItem(K_REGISTERED, new Date().toISOString());
  localStorage.setItem(K_LAST_LOGIN, new Date().toISOString());
  if (rec.deviceFp) localStorage.setItem(K_DEVICE_FP, rec.deviceFp);
}

export function recordLogin(): void {
  localStorage.setItem(K_LAST_LOGIN, new Date().toISOString());
}

export function getStoredShortId(): string | null {
  return localStorage.getItem(K_SHORT_ID);
}

export function getHoid(): string | null {
  return localStorage.getItem(K_HOID);
}

export function getTrustScore(): number {
  const v = Number(localStorage.getItem(K_TRUST));
  return Number.isFinite(v) && v > 0 ? v : 99.8;
}

export function getLastLogin(): Date | null {
  const v = localStorage.getItem(K_LAST_LOGIN);
  return v ? new Date(v) : null;
}

export function getHoidRecord(): HoidRecord | null {
  const hoid = getHoid();
  const shortId = getStoredShortId();
  if (!hoid || !shortId) return null;
  return {
    hoid,
    shortId,
    trustScore: getTrustScore(),
    registeredAt: localStorage.getItem(K_REGISTERED) ?? new Date().toISOString(),
    lastLogin: localStorage.getItem(K_LAST_LOGIN),
    deviceFp: localStorage.getItem(K_DEVICE_FP),
  };
}

/** Wipe device-side identity (used by "use a different identity" / reset). */
export function clearRegistration(): void {
  [K_HOID, K_SHORT_ID, K_TRUST, K_LAST_LOGIN, K_REGISTERED, K_DEVICE_FP].forEach((k) =>
    localStorage.removeItem(k)
  );
}
