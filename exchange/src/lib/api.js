import { publicErrorMessage } from './user-facing-error.js';

/**
 * Safe fetch helpers — never throw raw "Unexpected end of JSON" to users.
 */

function statusMessage(status, fallback) {
  if (status === 401) return 'Your session has expired.';
  if (status === 403) return 'You do not have access to that yet.';
  if (status === 404) return 'Not found';
  if (status >= 500) return 'Pinit Exchange is temporarily waking up.';
  return fallback;
}

export async function parseJsonSafe(res) {
  const text = await res.text();
  if (!text || !String(text).trim()) {
    console.warn('[api] empty response', res.status, res.url);
    return {
      ok: false,
      status: res.status,
      data: null,
      error: statusMessage(res.status, 'API returned an invalid response.'),
    };
  }
  if (/^\s*</.test(text)) {
    console.warn('[api] HTML response', res.status, res.url);
    return {
      ok: false,
      status: res.status,
      data: null,
      error: statusMessage(res.status, 'API returned an invalid response.'),
    };
  }
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text), error: null };
  } catch {
    console.warn('[api] invalid JSON', res.status, res.url);
    return {
      ok: false,
      status: res.status,
      data: null,
      error: statusMessage(res.status, 'API returned an invalid response.'),
    };
  }
}

function readStoredSession() {
  try {
    const raw = localStorage.getItem('pinit_exchange_session');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function sessionPinitId() {
  return readStoredSession()?.pinit_id || '';
}

/** Signed token proving this browser's identity. Empty until Hub SSO runs. */
function sessionToken() {
  return readStoredSession()?.token || '';
}

export async function apiFetch(url, options = {}) {
  try {
    const headers = { ...(options.headers || {}) };
    // The token is the credential; X-Pinit-Id is kept only so the API still
    // works during the rollout, before every session has been re-minted.
    const token = sessionToken();
    if (token && !headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
    const pid = sessionPinitId();
    if (pid && !headers['X-Pinit-Id'] && !headers['x-pinit-id']) {
      headers['X-Pinit-Id'] = pid;
    }
    if (!headers.Accept && !headers.accept) headers.Accept = 'application/json';
    const res = await fetch(url, { ...options, headers });
    const parsed = await parseJsonSafe(res);
    if (!parsed.ok) {
      const code = parsed.data?.error;
      const raw = parsed.data?.message;
      if (code === 'PAYMENT_UNAVAILABLE' || code === 'PAYMENT_INIT_FAILED') {
        return {
          ok: false,
          status: parsed.status,
          data: parsed.data,
          error: String(raw || 'Payment temporarily unavailable. You have not been charged. Please try again.'),
          headers: res.headers,
        };
      }
      const msg = publicErrorMessage(
        raw
          || (code && !/^[A-Z][A-Z0-9_]+$/.test(String(code)) ? String(code) : null)
          || parsed.error
          || statusMessage(parsed.status, 'Something went wrong'),
        parsed.status,
      );
      return { ok: false, status: parsed.status, data: parsed.data, error: msg, headers: res.headers };
    }
    return { ok: true, status: parsed.status, data: parsed.data, error: null, headers: res.headers };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: publicErrorMessage(
        err?.name === 'AbortError'
          ? 'Request timed out. Please try again.'
          : err?.message?.includes('Failed to fetch')
          ? 'Pinit Exchange is temporarily waking up.'
          : err?.message || 'Network error',
        0,
      ),
    };
  }
}

export function verticalLabel(v) {
  const map = {
    images: 'Images',
    video: 'Video',
    ui_ux: 'Design',
    design: 'Design',
    '3d': '3D',
    audio: 'Audio',
    concepts: 'Other',
    other: 'Other',
    documents: 'Documents',
    graphics: 'Design',
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

/**
 * Normalise a list response.
 *
 * Paginated endpoints return { items, total, limit, offset, has_more };
 * older ones returned a bare array. Callers should not care which.
 */
export function unwrapList(data, headers) {
  if (Array.isArray(data)) {
    // Paging travels in headers so the array body stays backward compatible
    // with clients deployed before pagination existed.
    const num = (h, fallback) => {
      const v = headers && typeof headers.get === 'function' ? headers.get(h) : null;
      const n = Number(v);
      return v !== null && v !== '' && Number.isFinite(n) ? n : fallback;
    };
    const hasMoreHeader = headers && typeof headers.get === 'function'
      ? headers.get('X-Has-More')
      : null;
    return {
      items: data,
      total: num('X-Total-Count', data.length),
      limit: num('X-Limit', data.length),
      offset: num('X-Offset', 0),
      hasMore: hasMoreHeader === 'true',
    };
  }
  if (data && Array.isArray(data.items)) {
    return {
      items: data.items,
      total: typeof data.total === 'number' ? data.total : data.items.length,
      limit: data.limit ?? data.items.length,
      offset: data.offset ?? 0,
      hasMore: Boolean(data.has_more),
    };
  }
  return { items: [], total: 0, limit: 0, offset: 0, hasMore: false };
}
