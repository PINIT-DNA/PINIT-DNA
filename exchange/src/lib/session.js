export const SESSION_KEY = 'pinit_exchange_session';

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
 * Persist the session.
 *
 * `token` is the signed session token minted by Hub SSO. It is what actually
 * proves who this browser is — the stored pinit_id alone proves nothing, since
 * Pinit IDs are public. Pass it on sign-in; omit it on profile updates and the
 * existing token is preserved rather than dropped.
 */
export function writeSession(user, token) {
  if (!user?.pinit_id) return;
  const existing = readSession();
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      pinit_id: user.pinit_id,
      user,
      token: token || existing?.token || null,
      at: Date.now(),
    }),
  );
}

/** The signed session token, or '' when this browser has not signed in. */
export function readSessionToken() {
  return readSession()?.token || '';
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
