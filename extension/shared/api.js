/**
 * PinIT API client for the extension service worker.
 */

import { getConfig, setTokens, clearTokens } from './config.js';

async function authHeaders() {
  const { accessToken } = await getConfig();
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

export async function apiJson(path, options = {}) {
  const { config, refreshToken } = await getConfig();
  const url = `${config.apiBaseUrl.replace(/\/$/, '')}${path}`;
  const headers = {
    ...(options.headers || {}),
    ...(await authHeaders()),
  };
  if (options.json) {
    headers['Content-Type'] = 'application/json';
  }

  let res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.json ? JSON.stringify(options.json) : options.body,
  });

  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken, config.apiBaseUrl);
    if (refreshed) {
      headers.Authorization = `Bearer ${refreshed}`;
      res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.json ? JSON.stringify(options.json) : options.body,
      });
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function refreshAccessToken(refreshToken, apiBaseUrl) {
  try {
    const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.accessToken) {
      await clearTokens();
      return null;
    }
    await setTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken || refreshToken,
      user: data.user,
    });
    return data.accessToken;
  } catch {
    await clearTokens();
    return null;
  }
}

export async function publishProtect(file, meta) {
  const { config } = await getConfig();
  const form = new FormData();
  form.append('media', file, file.name || 'publish-media.bin');
  Object.entries(meta || {}).forEach(([k, v]) => {
    if (v != null && v !== '') form.append(k, String(v));
  });
  form.append('extensionVersion', chrome.runtime.getManifest().version);

  const headers = await authHeaders();
  const res = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}/extension/publish-protect`, {
    method: 'POST',
    headers,
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Protect failed (${res.status})`);
  return data;
}

export async function registerPost(payload) {
  return apiJson('/extension/register-post', { method: 'POST', json: payload });
}

export async function verifyIdentity(file) {
  const { config } = await getConfig();
  const form = new FormData();
  form.append('image', file, file.name || 'verify.bin');
  const headers = await authHeaders();
  const res = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}/vault/verify-identity`, {
    method: 'POST',
    headers,
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Verify failed (${res.status})`);
  return data;
}

export async function exchangeAuthCode(code) {
  const { config } = await getConfig();
  const extensionId = chrome.runtime.id;
  const res = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}/auth/extension/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, extensionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'Auth exchange failed');
  await setTokens({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user: data.user,
  });
  return data;
}
