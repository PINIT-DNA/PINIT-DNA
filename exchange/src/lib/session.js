export const SESSION_KEY = 'pinit_exchange_session';
const AUTH_EVENT_KEY = 'pinit_exchange_auth_event';

export function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.pinit_id) return null;
    return session;
  } catch {
    return null;
  }
}

export function readCachedUser() {
  return readSession()?.user || null;
}

/**
 * Persist a non-secret profile cache. The session credential is the HttpOnly
 * cookie (plus a Bearer fallback only while a legacy token is still in storage).
 */
export function writeSession(user, _token) {
  if (!user?.pinit_id) return;
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      pinit_id: user.pinit_id,
      user,
      at: Date.now(),
    }),
  );
}

/** Legacy Bearer fallback while cookies roll out. */
export function readSessionToken() {
  return readSession()?.token || '';
}

export function broadcastExchangeAuth(type) {
  try {
    localStorage.setItem(AUTH_EVENT_KEY, JSON.stringify({ type, t: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  broadcastExchangeAuth('logout');
}
