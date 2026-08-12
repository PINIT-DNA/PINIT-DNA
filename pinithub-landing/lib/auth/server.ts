import { compare, hash } from 'bcryptjs';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { clientIp, rateLimit, resetRateLimit } from '@/lib/rate-limit';
import { atLeast, isRole, type Role } from './roles';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
  verifySession,
  type SessionPayload,
} from './tokens';

/** Server-side session handling. Never import this from a client component. */

const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string) {
  return hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, passwordHash: string) {
  return compare(plain, passwordHash);
}

/** Decode the cookie. Cheap — no database round trip. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

/**
 * Resolve the signed-in user against the database, so a deactivated account or
 * a password change takes effect immediately instead of when the token expires.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, email: true, name: true, role: true, active: true, tokenVersion: true },
  });

  if (!user || !user.active) return null;
  if (user.tokenVersion !== session.v) return null;
  if (!isRole(user.role)) return null;

  return { id: user.id, email: user.email, name: user.name ?? user.email, role: user.role };
}

/**
 * Gate a server component or action. Redirects to the login page when signed
 * out, and to the dashboard when signed in without sufficient privilege.
 */
export async function requireUser(minRole: Role = 'EDITOR'): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');
  if (!atLeast(user.role, minRole)) redirect('/admin?denied=1');
  return user;
}

/** Same gate for route handlers, which must return a response rather than redirect. */
export async function requireUserOrNull(minRole: Role = 'EDITOR'): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  if (!user || !atLeast(user.role, minRole)) return null;
  return user;
}

async function setSessionCookie(payload: SessionPayload) {
  const token = await signSession(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const ip = clientIp(await headers());

  // Two windows: one per address (slows targeted guessing), one per IP
  // (slows spraying across many addresses from one host).
  const perAccount = rateLimit(`login:acct:${normalized}`, 5, 15 * 60_000);
  const perIp = rateLimit(`login:ip:${ip}`, 20, 15 * 60_000);
  if (!perAccount.ok || !perIp.ok) {
    const wait = Math.max(perAccount.retryAfter, perIp.retryAfter);
    return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` };
  }

  const user = await prisma.user.findUnique({ where: { email: normalized } });

  // Compare against a dummy hash when the account is unknown, so a missing user
  // and a wrong password take the same amount of time to answer.
  const storedHash = user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const passwordOk = await verifyPassword(password, storedHash);

  if (!user || !passwordOk || !user.active || !isRole(user.role)) {
    await prisma.auditLog
      .create({
        data: {
          userEmail: normalized || '(blank)',
          action: 'LOGIN_FAILED',
          collection: 'auth',
          summary: `Failed sign-in from ${ip}`,
        },
      })
      .catch(() => undefined);
    return { ok: false, error: 'Incorrect email or password.' };
  }

  resetRateLimit(`login:acct:${normalized}`);

  await setSessionCookie({
    sub: user.id,
    email: user.email,
    name: user.name ?? user.email,
    role: user.role,
    v: user.tokenVersion,
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await prisma.auditLog
    .create({
      data: {
        userId: user.id,
        userEmail: user.email,
        action: 'LOGIN',
        collection: 'auth',
        summary: `Signed in from ${ip}`,
      },
    })
    .catch(() => undefined);

  return { ok: true };
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Re-issue the cookie, e.g. after a self-service password change. */
export async function refreshSession(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !isRole(user.role)) return;
  await setSessionCookie({
    sub: user.id,
    email: user.email,
    name: user.name ?? user.email,
    role: user.role,
    v: user.tokenVersion,
  });
}

/** Record an admin mutation. Failures here must never break the mutation itself. */
export async function audit(
  user: Pick<CurrentUser, 'id' | 'email'>,
  action: string,
  collection: string,
  recordId = '',
  summary = '',
) {
  await prisma.auditLog
    .create({ data: { userId: user.id, userEmail: user.email, action, collection, recordId, summary } })
    .catch(() => undefined);
}
