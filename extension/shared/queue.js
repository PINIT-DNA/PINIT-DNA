/**
 * Offline protect queue — persists captures when network/backend fails.
 * Retry with exponential backoff. Idempotent via clientRequestId.
 */

const QUEUE_KEY = 'pinit_protect_queue';
const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 5_000;

/**
 * @typedef {object} QueueItem
 * @property {string} id
 * @property {string} platform
 * @property {string} dataUrl
 * @property {string} [fileName]
 * @property {string} [postUrl]
 * @property {string} [mediaUrl]
 * @property {string} [profileUrl]
 * @property {string} [ownerAccount]
 * @property {string} [caption]
 * @property {string} [pageTitle]
 * @property {string} [platformPostId]
 * @property {number} attempts
 * @property {number} nextAttemptAt
 * @property {string} [lastError]
 * @property {'pending'|'processing'|'failed'|'done'} status
 * @property {number} createdAt
 */

export async function enqueueProtect(payload) {
  const { [QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(QUEUE_KEY);
  const id = payload.clientRequestId || `pq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const item = {
    id,
    clientRequestId: id,
    platform: payload.platform || 'web',
    dataUrl: payload.dataUrl,
    fileName: payload.fileName || `publish-${Date.now()}.bin`,
    postUrl: payload.postUrl || '',
    mediaUrl: payload.mediaUrl || '',
    profileUrl: payload.profileUrl || '',
    ownerAccount: payload.ownerAccount || '',
    caption: payload.caption || '',
    pageTitle: payload.pageTitle || '',
    platformPostId: payload.platformPostId || '',
    capturedVia: payload.capturedVia || 'extension_publish_guardian',
    attempts: 0,
    nextAttemptAt: Date.now(),
    status: 'pending',
    createdAt: Date.now(),
  };
  queue.push(item);
  // Cap queue size to protect storage
  const trimmed = queue.slice(-50);
  await chrome.storage.local.set({ [QUEUE_KEY]: trimmed });
  return item;
}

export async function getQueue() {
  const { [QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(QUEUE_KEY);
  return queue;
}

export async function saveQueue(queue) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

export function backoffMs(attempts) {
  const exp = Math.min(MAX_ATTEMPTS, Math.max(0, attempts));
  return Math.min(30 * 60 * 1000, BASE_DELAY_MS * (2 ** exp));
}

/**
 * Process due queue items using the provided publishFn({file, meta}).
 */
export async function processQueue(publishFn) {
  const queue = await getQueue();
  const now = Date.now();
  let changed = false;
  const results = [];

  for (const item of queue) {
    if (item.status === 'done') continue;
    if (item.status === 'failed' && item.attempts >= MAX_ATTEMPTS) continue;
    if (item.nextAttemptAt > now) continue;

    item.status = 'processing';
    item.attempts += 1;
    changed = true;

    try {
      const file = dataUrlToFile(item.dataUrl, item.fileName);
      const result = await publishFn(file, {
        platform: item.platform,
        postUrl: item.postUrl,
        mediaUrl: item.mediaUrl,
        profileUrl: item.profileUrl,
        ownerAccount: item.ownerAccount,
        caption: item.caption,
        pageTitle: item.pageTitle,
        platformPostId: item.platformPostId,
        clientRequestId: item.clientRequestId || item.id,
        capturedVia: item.capturedVia || 'extension_publish_guardian',
      });
      item.status = 'done';
      item.lastError = '';
      item.result = {
        protectedPostId: result.protectedPostId,
        vaultId: result.vaultId,
        certificateId: result.certificateId,
      };
      results.push({ id: item.id, ok: true, result });
    } catch (err) {
      item.lastError = String(err.message || err);
      item.nextAttemptAt = now + backoffMs(item.attempts);
      item.status = item.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      results.push({ id: item.id, ok: false, error: item.lastError });
    }
  }

  // Drop completed items older than 7 days; keep failed for UI
  const pruned = queue.filter((i) => {
    if (i.status === 'done' && now - i.createdAt > 7 * 24 * 60 * 60 * 1000) return false;
    return true;
  });

  if (changed || pruned.length !== queue.length) {
    await saveQueue(pruned);
  }

  return {
    results,
    pending: pruned.filter((i) => i.status === 'pending' || i.status === 'processing').length,
    failed: pruned.filter((i) => i.status === 'failed').length,
    done: pruned.filter((i) => i.status === 'done').length,
  };
}

function dataUrlToFile(dataUrl, name) {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'application/octet-stream';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}
