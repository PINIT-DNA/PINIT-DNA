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

export function writeSession(user) {
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

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
