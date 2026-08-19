/**
 * Hub bridge client — Exchange talks to Pinit HUB over HTTPS only.
 * Never imports Hub vault/DNA source code.
 */

import jwt from 'jsonwebtoken';

function hubApiBase() {
  return (process.env.HUB_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
}

function bridgeSecret() {
  return process.env.EXCHANGE_BRIDGE_SECRET || process.env.HUB_BRIDGE_SECRET || '';
}

/** Decode JWT payload without verification (legacy / debug only). Prefer verifyHubBridgeToken. */
export function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Verify Hub-signed bridge JWT (SSO or list-intent).
 * @param {string} token
 * @param {string} purpose e.g. 'exchange_sso' | 'exchange_list_intent'
 */
export function verifyHubBridgeToken(token, purpose) {
  if (!token) {
    const err = new Error('Missing Hub bridge token');
    err.status = 401;
    throw err;
  }
  const secret = bridgeSecret();
  if (!secret) {
    console.warn('[hub-client] EXCHANGE_BRIDGE_SECRET not set — JWT signature not verified');
    const payload = decodeJwtPayload(token);
    if (!payload || payload.purpose !== purpose) {
      const err = new Error('Invalid Hub bridge token');
      err.status = 401;
      throw err;
    }
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      const err = new Error('Hub bridge token expired');
      err.status = 401;
      throw err;
    }
    return payload;
  }

  try {
    const decoded = jwt.verify(String(token), secret);
    if (!decoded || decoded.purpose !== purpose) {
      const err = new Error('Invalid Hub bridge token purpose');
      err.status = 401;
      throw err;
    }
    return decoded;
  } catch (e) {
    if (e.status) throw e;
    const err = new Error('Invalid or expired Hub bridge token');
    err.status = 401;
    throw err;
  }
}

/** Fetch seller vault assets from real Pinit HUB (bridge secret). */
export async function fetchListableAssetsFromHub(pinitId) {
  const secret = bridgeSecret();
  if (!secret) {
    console.warn('[hub-client] EXCHANGE_BRIDGE_SECRET not set — cannot fetch Hub assets');
    return { assets: [], skipped: true, error: 'Bridge secret not configured' };
  }

  const url = `${hubApiBase()}/exchange/listable-assets-bridge?pinitId=${encodeURIComponent(pinitId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-PinIT-Bridge-Secret': secret,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Hub listable assets failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  return {
    pinitId: data.pinitId || pinitId,
    assets: Array.isArray(data.assets) ? data.assets : [],
  };
}

export async function confirmListingWithHub({
  vaultId,
  listingId,
  pinitId,
  exchangeUrl,
  status = 'live',
}) {
  const secret = bridgeSecret();
  if (!secret) {
    console.warn('[hub-client] EXCHANGE_BRIDGE_SECRET not set — skipping Hub confirm callback');
    return { skipped: true };
  }

  const res = await fetch(`${hubApiBase()}/exchange/listings/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PinIT-Bridge-Secret': secret,
    },
    body: JSON.stringify({
      vaultId,
      listingId,
      pinitId,
      exchangeUrl,
      status,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Hub confirm failed (${res.status})`);
  }
  return data;
}

export async function sealSaleWithHub({
  vaultId,
  orderId,
  listingId,
  buyerPinitId,
  licenseTier,
}) {
  const secret = bridgeSecret();
  if (!secret) {
    console.warn('[hub-client] EXCHANGE_BRIDGE_SECRET not set — skipping Hub seal callback');
    return { skipped: true };
  }

  const res = await fetch(`${hubApiBase()}/exchange/sales/seal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PinIT-Bridge-Secret': secret,
    },
    body: JSON.stringify({
      vaultId,
      orderId,
      listingId,
      buyerPinitId,
      licenseTier,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Hub seal failed (${res.status})`);
  }
  return data;
}

/** Workflow B: stream file to Hub for silent DNA + vault protect. */
export async function protectUploadWithHub({ pinitId, fileBuffer, fileName, mimeType }) {
  const secret = bridgeSecret();
  if (!secret) {
    const err = new Error('EXCHANGE_BRIDGE_SECRET not configured — cannot protect via Hub');
    err.status = 503;
    throw err;
  }

  const form = new FormData();
  form.append('pinitId', pinitId);
  form.append(
    'file',
    new Blob([fileBuffer instanceof Uint8Array ? fileBuffer : new Uint8Array(fileBuffer)], {
      type: mimeType || 'application/octet-stream',
    }),
    fileName || 'upload.bin',
  );

  const res = await fetch(`${hubApiBase()}/exchange/protect-upload`, {
    method: 'POST',
    headers: {
      'X-PinIT-Bridge-Secret': secret,
    },
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Hub protect-upload failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data.asset || data;
}

export async function prepareDeliveryWithHub(payload) {
  const secret = bridgeSecret();
  if (!secret) {
    console.warn('[hub-client] EXCHANGE_BRIDGE_SECRET not set — skipping delivery prepare');
    return { skipped: true };
  }

  const res = await fetch(`${hubApiBase()}/exchange/delivery/prepare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PinIT-Bridge-Secret': secret,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Hub delivery prepare failed (${res.status})`);
  }
  return data;
}

/** Public Hub profile (name, user id, Pinit User ID) for Exchange creator cards. */
export async function fetchHubProfiles(pinitIds) {
  const secret = bridgeSecret();
  const ids = [...new Set((pinitIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!secret || !ids.length) return { profiles: [], skipped: !secret };

  const url = `${hubApiBase()}/exchange/profiles-bridge?pinitIds=${encodeURIComponent(ids.join(','))}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-PinIT-Bridge-Secret': secret,
    },
  });
  const contentType = String(res.headers.get('content-type') || '');
  const data = contentType.includes('json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok || !contentType.includes('json')) {
    throw new Error(data.error || `Hub profiles failed (${res.status})`);
  }
  return {
    profiles: Array.isArray(data.profiles) ? data.profiles : [],
  };
}

export async function fetchMonitoringSummariesFromHub(pinitId) {
  const secret = bridgeSecret();
  if (!secret) {
    return { summaries: [], skipped: true };
  }

  const res = await fetch(
    `${hubApiBase()}/exchange/monitoring-summaries-bridge?pinitId=${encodeURIComponent(pinitId)}`,
    {
      headers: {
        Accept: 'application/json',
        'X-PinIT-Bridge-Secret': secret,
      },
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Hub monitoring summaries failed (${res.status})`);
  }
  return data;
}

/**
 * Stream marketplace preview bytes from Hub (bridge auth).
 * Returns { ok, status, headers, buffer } for Exchange to pipe to the browser.
 */
export async function fetchPreviewFromHub(vaultId) {
  const secret = bridgeSecret();
  if (!secret) {
    const err = new Error('EXCHANGE_BRIDGE_SECRET not configured');
    err.status = 503;
    throw err;
  }
  const res = await fetch(`${hubApiBase()}/exchange/preview/${encodeURIComponent(vaultId)}`, {
    headers: {
      'X-PinIT-Bridge-Secret': secret,
      Accept: '*/*',
    },
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    let message = `Hub preview failed (${res.status})`;
    try {
      message = JSON.parse(buffer.toString('utf8')).error || message;
    } catch {
      /* ignore */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return {
    buffer,
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    fileName: res.headers.get('content-disposition') || '',
    vaultId: res.headers.get('x-vault-id') || vaultId,
  };
}

export { hubApiBase as HUB_API_BASE, bridgeSecret as BRIDGE_SECRET };

/**
 * Ask Hub to create a share link for a file the buyer licensed.
 *
 * Hub owns custody and tracking, so the ShareLink lives there and every view or
 * download flows through Hub's existing share viewer + ShareAccessLog. Exchange
 * must verify the caller owns the seal BEFORE calling this — the bridge secret
 * authenticates the service, not the end user.
 */
export async function createLicensedShareOnHub({ assetId, sealId, orderId, buyerPinitId, licenseTier, options }) {
  const secret = bridgeSecret();
  if (!secret) {
    const err = new Error('EXCHANGE_BRIDGE_SECRET not configured');
    err.status = 503;
    throw err;
  }
  const res = await fetch(`${hubApiBase()}/exchange/share/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PinIT-Bridge-Secret': secret,
    },
    body: JSON.stringify({ assetId, sealId, orderId, buyerPinitId, licenseTier, options: options || {} }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Hub share creation failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
