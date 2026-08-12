/**
 * Safe fetch helpers — never throw raw "Unexpected end of JSON" to users.
 */

export async function parseJsonSafe(res) {
  const text = await res.text();
  if (!text || !String(text).trim()) {
    return { ok: false, status: res.status, data: null, error: 'Empty response from server' };
  }
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text), error: null };
  } catch {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: res.ok ? 'Invalid response from server' : `Request failed (${res.status})`,
    };
  }
}

function sessionPinitId() {
  try {
    const raw = localStorage.getItem('pinit_exchange_session');
    if (!raw) return '';
    return JSON.parse(raw)?.pinit_id || '';
  } catch {
    return '';
  }
}

export async function apiFetch(url, options = {}) {
  try {
    const headers = { ...(options.headers || {}) };
    const pid = sessionPinitId();
    if (pid && !headers['X-Pinit-Id'] && !headers['x-pinit-id']) {
      headers['X-Pinit-Id'] = pid;
    }
    const res = await fetch(url, { ...options, headers });
    const parsed = await parseJsonSafe(res);
    if (!parsed.ok) {
      const msg =
        parsed.data?.error ||
        parsed.data?.message ||
        parsed.error ||
        (parsed.status === 401
          ? 'Please sign in again'
          : parsed.status === 403
            ? 'You do not have access'
            : parsed.status === 404
              ? 'Not found'
              : parsed.status >= 500
                ? 'Server error — try again shortly'
                : 'Something went wrong');
      return { ok: false, status: parsed.status, data: parsed.data, error: msg };
    }
    return { ok: true, status: parsed.status, data: parsed.data, error: null };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err?.message?.includes('Failed to fetch')
        ? 'Cannot reach Exchange API. Is the server running on port 5000?'
        : err?.message || 'Network error',
    };
  }
}

export function verticalLabel(v) {
  const map = {
    images: 'Photography',
    video: 'Video',
    ui_ux: 'UI/UX',
    '3d': '3D',
    audio: 'Audio',
    concepts: 'Concepts',
    graphics: 'Graphics',
  };
  return map[v] || v || 'Creative';
}

/** Pinit Verified hierarchy — buyer-facing labels only */
export function verifiedLabel(badge) {
  const b = String(badge || '').toLowerCase();
  if (b === 'gold') return 'Gold — Human-authenticated';
  if (b === 'silver') return 'Silver — Pinit Verified';
  if (b === 'bronze') return 'Bronze — Pinit Verified';
  return 'Pinit Verified';
}
