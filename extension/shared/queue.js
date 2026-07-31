/**
 * Offline protect queue — persists captures when network/backend fails.
 * Retry with exponential backoff. Idempotent via clientRequestId.
 *
 * Large payloads: chrome.storage cannot hold big dataUrls. Callers should
 * only enqueue byte payloads under MAX_DURABLE_DATAURL_CHARS.
 */

const QUEUE_KEY = 'pinit_protect_queue';
const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 5_000;
/** ~3MB file as base64 data URL — above this, durable offline queue is skipped */
export const MAX_DURABLE_DATAURL_CHARS = 4_000_000;
const STUCK_PROCESSING_MS = 15 * 60 * 1000;

/**
 * @typedef {object} QueueItem
 * @property {string} id
 * @property {string} platform
 * @property {string} [dataUrl]
 * @property {string} [fileName]
 * @property {string} [postUrl]
 * @property {string} [pageUrl]
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
 * @property {number} [processingStartedAt]
 */

export function canDurableEnqueue(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return false;
  return dataUrl.length <= MAX_DURABLE_DATAURL_CHARS;
}

export function backoffMs(attempts) {
  // Cap exponent so delay reaches the 30-minute ceiling, independent of MAX_ATTEMPTS
  const exp = Math.min(10, Math.max(0, attempts));
  return Math.min(30 * 60 * 1000, BASE_DELAY_MS * (2 ** exp));
}

export async function enqueueProtect(payload) {
  const { [QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(QUEUE_KEY);
  const id = payload.clientRequestId || `pq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  if (payload.dataUrl && !canDurableEnqueue(payload.dataUrl)) {
    const err = new Error(
      'File too large for offline queue — stay online and retry protect',
    );
    err.code = 'PAYLOAD_TOO_LARGE';
    console.error('[PinIT] [queue] [enqueue.rejected_too_large]', {
      id,
      platform: payload.platform,
      fileName: payload.fileName,
      dataUrlChars: payload.dataUrl.length,
      max: MAX_DURABLE_DATAURL_CHARS,
    });
    throw err;
  }

  // Deduplicate active items with same clientRequestId
  const existing = queue.find(
    (i) =>
      (i.clientRequestId === id || i.id === id) &&
      (i.status === 'pending' || i.status === 'processing'),
  );
  if (existing) {
    console.info('[PinIT] [queue] [enqueue.dedupe]', { id: existing.id, status: existing.status });
    return existing;
  }

  const item = {
    id,
    clientRequestId: id,
    platform: payload.platform || 'web',
    dataUrl: payload.dataUrl || '',
    fileName: payload.fileName || `publish-${Date.now()}.bin`,
    postUrl: payload.postUrl || '',
    pageUrl: payload.pageUrl || '',
    mediaUrl: payload.mediaUrl || '',
    profileUrl: payload.profileUrl || '',
    ownerAccount: payload.ownerAccount || '',
    caption: payload.caption || '',
    pageTitle: payload.pageTitle || '',
    platformPostId: payload.platformPostId || '',
    capturedVia: payload.capturedVia || 'extension_publish_guardian',
    pipelineId: payload.pipelineId || '',
    attempts: 0,
    nextAttemptAt: Date.now(),
    status: 'pending',
    createdAt: Date.now(),
  };
  queue.push(item);
  const trimmed = queue.slice(-50);
  await chrome.storage.local.set({ [QUEUE_KEY]: trimmed });
  console.info('[PinIT] [queue] [enqueue.created]', {
    id: item.id,
    platform: item.platform,
    fileName: item.fileName,
    pageUrl: item.pageUrl,
    hasDataUrl: !!item.dataUrl,
    dataUrlChars: item.dataUrl ? item.dataUrl.length : 0,
    hasMediaUrl: !!item.mediaUrl,
    pipelineId: item.pipelineId || null,
  });
  return item;
}

export async function markQueueItemDone(id, result) {
  if (!id) return;
  const queue = await getQueue();
  let changed = false;
  for (const item of queue) {
    if (item.id === id || item.clientRequestId === id) {
      item.status = 'done';
      item.lastError = '';
      item.result = result
        ? {
            protectedPostId: result.protectedPostId,
            vaultId: result.vaultId,
            certificateId: result.certificateId,
            assetId: result.assetId,
            monitorId: result.monitorId,
          }
        : item.result;
      changed = true;
    }
  }
  if (changed) await saveQueue(queue);
}

export async function getQueue() {
  const { [QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(QUEUE_KEY);
  return queue;
}

export async function saveQueue(queue) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

/**
 * Process due queue items using the provided publishFn(file, meta).
 */
export async function processQueue(publishFn) {
  const queue = await getQueue();
  const now = Date.now();
  let changed = false;
  const results = [];

  for (const item of queue) {
    // Recover stuck processing (SW killed mid-upload)
    if (
      item.status === 'processing' &&
      item.processingStartedAt &&
      now - item.processingStartedAt > STUCK_PROCESSING_MS
    ) {
      item.status = item.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      item.nextAttemptAt = now;
      changed = true;
    }

    if (item.status === 'done') continue;
    if (item.status === 'failed' && item.attempts >= MAX_ATTEMPTS) continue;
    if (item.status === 'processing') continue;
    if (item.nextAttemptAt > now) continue;

    if (!item.dataUrl && !item.mediaUrl) {
      item.status = 'failed';
      item.lastError = 'No media payload in queue item';
      item.attempts = MAX_ATTEMPTS;
      changed = true;
      console.error('[PinIT] [queue] [process.fail_no_payload]', {
        id: item.id,
        platform: item.platform,
        fileName: item.fileName,
        lastError: item.lastError,
      });
      await persistLastQueueFailure(item);
      results.push({ id: item.id, ok: false, error: item.lastError });
      continue;
    }

    item.status = 'processing';
    item.processingStartedAt = now;
    item.attempts += 1;
    changed = true;
    await saveQueue(queue);
    console.info('[PinIT] [queue] [process.start]', {
      id: item.id,
      attempt: item.attempts,
      platform: item.platform,
      fileName: item.fileName,
      pageUrl: item.pageUrl,
      hasDataUrl: !!item.dataUrl,
      dataUrlChars: item.dataUrl ? item.dataUrl.length : 0,
    });

    try {
      let file;
      if (item.dataUrl) {
        file = dataUrlToFile(item.dataUrl, item.fileName);
      } else {
        const res = await fetch(item.mediaUrl);
        if (!res.ok) throw new Error(`Failed to fetch media (${res.status})`);
        const blob = await res.blob();
        file = new File([blob], item.fileName || 'publish-media.bin', {
          type: blob.type || 'application/octet-stream',
        });
      }
      console.info('[PinIT] [queue] [process.publish_begin]', {
        id: item.id,
        fileName: file.name,
        size: file.size,
        type: file.type,
      });
      const result = await publishFn(file, {
        platform: item.platform,
        postUrl: item.postUrl,
        pageUrl: item.pageUrl,
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
      item.processingStartedAt = undefined;
      item.result = {
        protectedPostId: result.protectedPostId,
        vaultId: result.vaultId,
        certificateId: result.certificateId,
        assetId: result.assetId,
        monitorId: result.monitorId,
      };
      item.dataUrl = '';
      console.info('[PinIT] [queue] [process.success]', {
        id: item.id,
        vaultId: result.vaultId,
        assetId: result.assetId,
        certificateId: result.certificateId,
        monitorId: result.monitorId,
      });
      results.push({
        id: item.id,
        ok: true,
        result,
        platform: item.platform,
        pageUrl: item.pageUrl,
        postUrl: item.postUrl,
        fileName: item.fileName,
      });
    } catch (err) {
      item.lastError = String(err.message || err);
      item.lastErrorStack = err && err.stack ? String(err.stack) : '';
      item.nextAttemptAt = now + backoffMs(item.attempts);
      item.status = item.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      item.processingStartedAt = undefined;
      console.error('[PinIT] [queue] [process.failure]', {
        id: item.id,
        attempt: item.attempts,
        status: item.status,
        platform: item.platform,
        fileName: item.fileName,
        pageUrl: item.pageUrl,
        error: item.lastError,
        stack: item.lastErrorStack,
        nextAttemptAt: item.nextAttemptAt,
      });
      await persistLastQueueFailure(item);
      results.push({
        id: item.id,
        ok: false,
        error: item.lastError,
        stack: item.lastErrorStack,
      });
    }
  }

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

async function persistLastQueueFailure(item) {
  try {
    await chrome.storage.local.set({
      lastQueueFailure: {
        at: Date.now(),
        id: item.id,
        platform: item.platform,
        fileName: item.fileName,
        pageUrl: item.pageUrl,
        attempts: item.attempts,
        status: item.status,
        error: item.lastError,
        stack: item.lastErrorStack || null,
      },
    });
  } catch {
    /* ignore */
  }
}
