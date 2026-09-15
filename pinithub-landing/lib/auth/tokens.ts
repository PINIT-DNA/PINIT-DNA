import { SignJWT, jwtVerify } from 'jose';
import { isRole, type Role } from './roles';

/**
 * Session tokens. `jose` is WebCrypto-based, so this module works unchanged in
 * the edge middleware and in Node server components — which is why the cookie
 * can be checked before a request ever reaches a route handler.
 */

export const SESSION_COOKIE = 'pinithub_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

export type SessionPayload = {
  /** User id. */
  sub: string;
  email: string;
  name: string;
  role: Role;
  /** Mirrors User.tokenVersion; a bump invalidates every issued token. */
  v: number;
};

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or shorter than 32 characters. Set it in .env — see .env.example.',
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name, role: payload.role, v: payload.v })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer('pinithub')
    .setAudience('pinithub-admin')
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

/** Verify signature, issuer, audience, and expiry. Returns null on any failure. */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: 'pinithub',
      audience: 'pinithub-admin',
    });
    if (!payload.sub || !isRole(payload.role)) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
      role: payload.role,
      v: typeof payload.v === 'number' ? payload.v : 0,
    };
  } catch {
    return null;
  }
}
