/**
 * PinIT Publish Guardian — background service worker (MV3).
 * Sprint 1–3 foundation + protect pipeline hardening.
 */

import { getConfig, clearTokens } from '../shared/config.js';
import { publishProtect, registerPost, verifyIdentity, exchangeAuthCode, apiJson } from '../shared/api.js';
import {
  enqueueProtect,
  processQueue,
  getQueue,
  saveQueue,
  markQueueItemDone,
  canDurableEnqueue,
} from '../shared/queue.js';

const EXTENSION_VERSION = chrome.runtime.getManifest().version;

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenus();
  ensureAlarms();
  void recordHealth('installed');
  void flushQueue();
});

chrome.runtime.onStartup?.addListener?.(() => {
  ensureContextMenus();
  ensureAlarms();
  void recordHealth('startup');
  void flushQueue();
});

ensureContextMenus();
ensureAlarms();
void recordHealth('boot');
void flushQueue();

function ensureAlarms() {
  chrome.alarms.create('pinit-queue-flush', { periodInMinutes: 1 });
  chrome.alarms.create('pinit-sync', { periodInMinutes: 15 });
  chrome.alarms.create('pinit-health', { periodInMinutes: 30 });
}

function ensureContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'pinit-verify',
      title: 'Verify with PinIT',
      contexts: ['image', 'video'],
    });
    chrome.contextMenus.create({
      id: 'pinit-protect',
      title: 'Protect with PinIT',
      contexts: ['image', 'video', 'page'],
    });
    chrome.contextMenus.create({
      id: 'pinit-investigate',
      title: 'Open PinIT Investigation',
      contexts: ['image', 'video', 'page'],
    });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pinit-queue-flush') void flushQueue();
  if (alarm.name === 'pinit-sync') void syncFromHub();
  if (alarm.name === 'pinit-health') void recordHealth('alarm');
});

async function recordHealth(reason) {
  const queue = await getQueue();
  const { accessToken } = await getConfig();
  const health = {
    at: Date.now(),
    reason,
    version: EXTENSION_VERSION,
    signedIn: !!accessToken,
    online: navigator.onLine,
    queuePending: queue.filter((i) => i.status === 'pending' || i.status === 'processing').length,
    queueFailed: queue.filter((i) => i.status === 'failed').length,
  };
  await chrome.storage.local.set({ extensionHealth: health });
  console.info('[PinIT] Health', health);
  return health;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'pinit-investigate') {
    const { config } = await getConfig();
    const hub = config.hubBaseUrl.replace(/\/$/, '');
    chrome.tabs.create({ url: `${hub}/pinit-hub/investigation` });
    return;
  }

  if (info.menuItemId === 'pinit-protect') {
    const pageUrl = info.pageUrl || tab?.url || '';
    const platform = detectPlatformFromUrl(pageUrl) || 'web';
    let mediaUrl = info.srcUrl || '';

    if (!mediaUrl && tab?.id) {
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const og = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
            const tw = document.querySelector('meta[name="twitter:image"]')?.getAttribute('content');
            const poster = document.querySelector('video')?.getAttribute('poster');
            const thumb =
              document.querySelector('ytd-reel-video-renderer #thumbnail img, ytd-player img')?.src ||
              null;
            return og || tw || poster || thumb || null;
          },
        });
        if (result) mediaUrl = result;
      } catch {
        /* ignore */
      }
    }

    if (!mediaUrl) {
      await setBadge('!', '#ef4444');
      await chrome.storage.local.set({
        lastProtect: {
          at: Date.now(),
          error: true,
          degraded: true,
          message:
            'No media found. On YouTube Studio: choose a file to upload (PinIT captures automatically), or Shift+Right-click → Protect with PinIT.',
          platform,
          pageUrl,
          postUrl: pageUrl,
        },
      });
      return;
    }

    return handleMessage({
      type: 'PUBLISH_CAPTURE',
      platform,
      mediaUrl,
      postUrl: pageUrl,
      pageUrl,
      pageTitle: tab?.title || '',
      fileName: `protect-${Date.now()}.bin`,
      capturedVia: 'extension_context_menu',
    });
  }

  if (info.menuItemId === 'pinit-verify' && info.srcUrl) {
    try {
      await setBadge('…', '#6366f1');
      const file = await fetchAsFile(info.srcUrl, 'verify-image.bin');
      const result = await verifyIdentity(file);
      const found = !!(result.found || (result.success && result.identity));
      await setBadge(found ? 'OK' : '—', found ? '#10b981' : '#6b7280');
      await chrome.storage.local.set({
        lastVerify: {
          at: Date.now(),
          found,
          message: result.message || (found ? 'Match found' : 'No PINIT match'),
          pageUrl: info.pageUrl || tab?.url || null,
        },
      });
    } catch (err) {
      await setBadge('!', '#ef4444');
      await chrome.storage.local.set({
        lastVerify: { at: Date.now(), found: false, message: String(err.message || err), error: true },
      });
    }
  }
});

function detectPlatformFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const map = [
      ['instagram.com', 'instagram'],
      ['facebook.com', 'facebook'],
      ['x.com', 'x'],
      ['twitter.com', 'x'],
      ['pinterest.com', 'pinterest'],
      ['linkedin.com', 'linkedin'],
      ['github.com', 'github'],
      ['telegram.org', 'telegram'],
      ['studio.youtube.com', 'youtube'],
      ['youtube.com', 'youtube'],
      ['tiktok.com', 'tiktok'],
      ['threads.net', 'threads'],
      ['reddit.com', 'reddit'],
      ['tumblr.com', 'tumblr'],
      ['behance.net', 'behance'],
      ['dribbble.com', 'dribbble'],
      ['deviantart.com', 'deviantart'],
      ['artstation.com', 'artstation'],
      ['vimeo.com', 'vimeo'],
      ['medium.com', 'medium'],
      ['substack.com', 'substack'],
      ['patreon.com', 'patreon'],
      ['canva.com', 'canva'],
      ['figma.com', 'figma'],
      ['myshopify.com', 'shopify'],
      ['shopify.com', 'shopify'],
      ['twitch.tv', 'twitch'],
    ];
    for (const [domain, id] of map) {
      if (host === domain || host.endsWith(`.${domain}`)) return id;
    }
    if (url.includes('/wp-admin/')) return 'wordpress';
  } catch {
    /* ignore */
  }
  return 'web';
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: String(err.message || err) });
  });
  return true;
});

function buildDegradedFlags(result) {
  const degraded = [];
  if (!result?.certificateId) degraded.push('certificate_missing');
  if (!result?.monitorId) degraded.push('monitoring_missing');
  if (!result?.vaultId) degraded.push('vault_missing');
  if (!result?.dnaRecordId) degraded.push('dna_missing');
  return {
    degraded: degraded.length > 0,
    degradedReasons: degraded,
  };
}

/** Persist bindable protect context for REGISTER_POST / late URL binding. */
async function persistLastProtectSuccess(result, meta = {}) {
  const flags = buildDegradedFlags(result);
  const lastProtect = {
    at: Date.now(),
    ...result,
    ...flags,
    platform: meta.platform || result.platform || 'web',
    pageUrl: meta.pageUrl || '',
    postUrl: meta.postUrl || '',
    fileName: meta.fileName || '',
    pending: false,
    error: false,
    message: flags.degraded
      ? `Protected with degraded state: ${flags.degradedReasons.join(', ')}`
      : result.message || 'Protected',
  };
  await chrome.storage.local.set({
    lastProtect,
    lastCaptureAttempt: {
      at: Date.now(),
      stage: 'protect.success',
      platform: lastProtect.platform,
      pageUrl: lastProtect.pageUrl,
      fileName: lastProtect.fileName,
      assetId: result.assetId || null,
      vaultId: result.vaultId || null,
      protectedPostId: result.protectedPostId || null,
    },
  });
  await setBadge(flags.degraded ? '!' : '✓', flags.degraded ? '#f59e0b' : '#10b981');
  console.info('[PinIT] [sw] [lastProtect.stored]', {
    assetId: result.assetId || null,
    vaultId: result.vaultId || null,
    protectedPostId: result.protectedPostId || null,
    platform: lastProtect.platform,
    pageUrl: lastProtect.pageUrl || null,
  });
  return { lastProtect, flags };
}

async function persistLastProtectPending(meta = {}) {
  await chrome.storage.local.set({
    lastProtect: {
      at: Date.now(),
      pending: true,
      error: false,
      platform: meta.platform || 'web',
      pageUrl: meta.pageUrl || '',
      postUrl: meta.postUrl || '',
      fileName: meta.fileName || '',
      queueId: meta.queueId || null,
      message: meta.message || 'Protect pending — waiting for publish-protect success',
    },
    lastCaptureAttempt: {
      at: Date.now(),
      stage: meta.stage || 'protect.pending',
      platform: meta.platform || 'web',
      pageUrl: meta.pageUrl || '',
      fileName: meta.fileName || '',
      queueId: meta.queueId || null,
      error: meta.error || null,
    },
  });
}

async function handleMessage(message) {
  switch (message?.type) {
    case 'GET_STATUS': {
      const state = await getConfig();
      const last = await chrome.storage.local.get([
        'lastProtect',
        'lastVerify',
        'syncSnapshot',
        'extensionHealth',
        'lastQueueFailure',
        'captureTelemetry',
        'lastCaptureAttempt',
      ]);
      const queue = await getQueue();
      const health = last.extensionHealth || (await recordHealth('status'));
      const failedItems = queue
        .filter((i) => i.status === 'failed' || (i.lastError && i.status !== 'done'))
        .slice(-5)
        .map((i) => ({
          id: i.id,
          status: i.status,
          platform: i.platform,
          fileName: i.fileName,
          attempts: i.attempts,
          error: i.lastError || null,
          stack: i.lastErrorStack || null,
          pageUrl: i.pageUrl || null,
        }));
      return {
        ok: true,
        signedIn: !!state.accessToken,
        user: state.user,
        config: state.config,
        version: EXTENSION_VERSION,
        health,
        lastProtect: last.lastProtect || null,
        lastVerify: last.lastVerify || null,
        syncSnapshot: last.syncSnapshot || null,
        lastQueueFailure: last.lastQueueFailure || null,
        captureTelemetry: last.captureTelemetry || null,
        lastCaptureAttempt: last.lastCaptureAttempt || null,
        queue: {
          pending: queue.filter((i) => i.status === 'pending' || i.status === 'processing').length,
          failed: queue.filter((i) => i.status === 'failed').length,
          done: queue.filter((i) => i.status === 'done').length,
          failedItems,
        },
      };
    }
    case 'PING':
      return { ok: true, version: EXTENSION_VERSION, at: Date.now() };
    case 'SIGN_OUT':
      await clearTokens();
      await setBadge('', '#6366f1');
      await recordHealth('sign_out');
      return { ok: true };
    case 'EXCHANGE_AUTH_CODE': {
      const data = await exchangeAuthCode(message.code);
      await syncFromHub();
      await recordHealth('auth_connected');
      return { ok: true, user: data.user };
    }
    case 'OPEN_AUTH': {
      const { config } = await getConfig();
      const url = `${config.hubBaseUrl.replace(/\/$/, '')}/extension/auth?ext_id=${encodeURIComponent(chrome.runtime.id)}`;
      chrome.tabs.create({ url });
      return { ok: true };
    }
    case 'FLUSH_QUEUE':
      return { ok: true, ...(await flushQueue()) };
    case 'SYNC_NOW':
      return { ok: true, ...(await syncFromHub()) };
    case 'SELF_TEST_PROTECT': {
      // Tiny PNG through the same publish-protect path (no YouTube login required).
      console.info('[PinIT] [sw] [SELF_TEST_PROTECT.begin]');
      const { accessToken } = await getConfig();
      if (!accessToken) {
        return { ok: false, error: 'Sign in before running pipeline self-test' };
      }
      if (!navigator.onLine) {
        return { ok: false, error: 'Must be online for pipeline self-test' };
      }
      const pngB64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const dataUrl = `data:image/png;base64,${pngB64}`;
      const file = dataUrlToFile(dataUrl, `pinit-selftest-${Date.now()}.png`);
      const clientRequestId = `selftest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        const result = await publishProtect(file, {
          platform: 'youtube',
          pageUrl: 'https://studio.youtube.com/selftest',
          postUrl: '',
          caption: 'PinIT extension pipeline self-test',
          pageTitle: 'PinIT SELF_TEST_PROTECT',
          clientRequestId,
          capturedVia: 'extension_self_test',
        });
        const flags = buildDegradedFlags(result);
        await chrome.storage.local.set({
          lastProtect: {
            at: Date.now(),
            ...result,
            ...flags,
            platform: 'youtube',
            pageUrl: 'https://studio.youtube.com/selftest',
            postUrl: '',
            message: flags.degraded
              ? `Self-test degraded: ${flags.degradedReasons.join(', ')}`
              : 'Self-test protect succeeded',
            selfTest: true,
          },
        });
        await setBadge(flags.degraded ? '!' : '✓', flags.degraded ? '#f59e0b' : '#10b981');
        console.info('[PinIT] [sw] [SELF_TEST_PROTECT.success]', {
          assetId: result.assetId,
          vaultId: result.vaultId,
          certificateId: result.certificateId,
          monitorId: result.monitorId,
          clientRequestId,
        });
        return { ok: true, result, clientRequestId, degraded: flags.degraded };
      } catch (err) {
        const error = String(err.message || err);
        const stack = err && err.stack ? String(err.stack) : '';
        console.error('[PinIT] [sw] [SELF_TEST_PROTECT.failure]', {
          clientRequestId,
          error,
          stack,
        });
        await chrome.storage.local.set({
          lastQueueFailure: {
            at: Date.now(),
            id: clientRequestId,
            platform: 'youtube',
            fileName: file.name,
            pageUrl: 'https://studio.youtube.com/selftest',
            attempts: 1,
            status: 'failed',
            error,
            stack,
            selfTest: true,
          },
          lastProtect: {
            at: Date.now(),
            error: true,
            message: error,
            platform: 'youtube',
            selfTest: true,
          },
        });
        await setBadge('!', '#ef4444');
        return { ok: false, error, stack, clientRequestId };
      }
    }
    case 'PUBLISH_CAPTURE': {
      console.info('[PinIT] [sw] [PUBLISH_CAPTURE.received]', {
        pipelineId: message.pipelineId || null,
        platform: message.platform || 'web',
        fileName: message.fileName || null,
        pageUrl: message.pageUrl || null,
        postUrl: message.postUrl || null,
        capturedVia: message.capturedVia || 'extension_publish_guardian',
        hasDataUrl: !!message.dataUrl,
        dataUrlChars: message.dataUrl ? message.dataUrl.length : 0,
        hasMediaUrl: !!message.mediaUrl,
      });
      try {
        const { captureTelemetry: prev = { stages: [] } } = await chrome.storage.local.get([
          'captureTelemetry',
        ]);
        const stages = Array.isArray(prev.stages) ? prev.stages.slice(-40) : [];
        stages.push({
          at: Date.now(),
          platform: message.platform || 'web',
          stage: 'PUBLISH_CAPTURE.received',
          details: {
            pipelineId: message.pipelineId || null,
            name: message.fileName || null,
            pageUrl: message.pageUrl || null,
            via: message.capturedVia || null,
          },
        });
        await chrome.storage.local.set({
          captureTelemetry: {
            ...prev,
            at: Date.now(),
            platform: message.platform || prev.platform || 'web',
            pageUrl: message.pageUrl || prev.pageUrl || null,
            lastStage: 'PUBLISH_CAPTURE.received',
            stages,
          },
          lastCaptureAttempt: {
            at: Date.now(),
            stage: 'PUBLISH_CAPTURE.received',
            pipelineId: message.pipelineId || null,
            platform: message.platform || 'web',
            fileName: message.fileName || null,
            pageUrl: message.pageUrl || null,
            dataUrlChars: message.dataUrl ? message.dataUrl.length : 0,
            capturedVia: message.capturedVia || null,
          },
        });
      } catch {
        /* ignore */
      }
      const { config, accessToken } = await getConfig();
      if (!config.publishGuardianEnabled) {
        return { ok: false, error: 'Publish Guardian disabled in options' };
      }
      const platformEnabled =
        message.platform === 'web' ||
        config.platforms?.[message.platform] !== false;
      if (!platformEnabled) {
        return { ok: false, skipped: true, error: `Platform ${message.platform} disabled` };
      }
      if (!message.dataUrl && !message.mediaUrl) {
        throw new Error('No media captured');
      }

      const online = navigator.onLine;
      const signedIn = !!accessToken;
      const durable = message.dataUrl ? canDurableEnqueue(message.dataUrl) : !!message.mediaUrl;

      // Large online upload: skip durable byte queue to avoid storage quota failure
      if (message.dataUrl && !durable && signedIn && online) {
        console.info('[PinIT] Large payload — immediate upload (no durable byte queue)');
        try {
          const file = dataUrlToFile(message.dataUrl, message.fileName || 'publish-media.bin');
          const clientRequestId =
            message.clientRequestId || `pq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          const result = await publishProtect(file, {
            platform: message.platform || 'web',
            postUrl: message.postUrl || '',
            pageUrl: message.pageUrl || '',
            mediaUrl: message.mediaUrl || '',
            profileUrl: message.profileUrl || '',
            platformPostId: message.platformPostId || '',
            ownerAccount: message.ownerAccount || '',
            caption: message.caption || '',
            pageTitle: message.pageTitle || '',
            clientRequestId,
            capturedVia: message.capturedVia || 'extension_publish_guardian',
          });
          const { flags } = await persistLastProtectSuccess(result, {
            platform: message.platform,
            pageUrl: message.pageUrl || '',
            postUrl: message.postUrl || '',
            fileName: message.fileName || '',
          });
          console.info('[PinIT] Protect success (large)', {
            assetId: result.assetId,
            vaultId: result.vaultId,
            certificateId: result.certificateId,
            monitorId: result.monitorId,
            degraded: flags.degraded,
          });
          return { ok: true, result, clientRequestId, degraded: flags.degraded };
        } catch (err) {
          await setBadge('!', '#ef4444');
          const error = String(err.message || err);
          const stack = err && err.stack ? String(err.stack) : '';
          console.error('[PinIT] [sw] [PUBLISH_CAPTURE.large_protect_failed]', {
            pipelineId: message.pipelineId || null,
            fileName: message.fileName || null,
            error,
            stack,
          });
          await chrome.storage.local.set({
            lastProtect: {
              at: Date.now(),
              error: true,
              degraded: true,
              message: error,
              platform: message.platform,
              pageUrl: message.pageUrl || '',
            },
            lastQueueFailure: {
              at: Date.now(),
              id: message.pipelineId || message.clientRequestId || `large_${Date.now()}`,
              platform: message.platform,
              fileName: message.fileName,
              pageUrl: message.pageUrl,
              attempts: 1,
              status: 'failed',
              error,
              stack,
              largeImmediate: true,
            },
          });
          return {
            ok: false,
            error,
            message: 'Large file protect failed — keep the tab open and retry while online',
          };
        }
      }

      if (!durable && (!signedIn || !online)) {
        return {
          ok: false,
          error: 'File too large for offline queue — sign in and stay online',
        };
      }

      let queued;
      try {
        queued = await enqueueProtect(message);
      } catch (err) {
        return { ok: false, error: String(err.message || err) };
      }

      if (!signedIn || !online) {
        await setBadge('Q', '#f59e0b');
        await persistLastProtectPending({
          platform: message.platform,
          pageUrl: message.pageUrl || '',
          postUrl: message.postUrl || '',
          fileName: message.fileName || '',
          queueId: queued.id,
          stage: 'protect.queued_offline',
          message: 'Saved offline — will sync when online',
        });
        return {
          ok: true,
          queued: true,
          clientRequestId: queued.id,
          message: 'Saved offline — will sync when online',
        };
      }

      try {
        const file = message.dataUrl
          ? dataUrlToFile(message.dataUrl, message.fileName || 'publish-media.bin')
          : await fetchAsFile(message.mediaUrl, message.fileName || 'publish-media.bin');
        const result = await publishProtect(file, {
          platform: message.platform || 'web',
          postUrl: message.postUrl || '',
          pageUrl: message.pageUrl || '',
          mediaUrl: message.mediaUrl || '',
          profileUrl: message.profileUrl || '',
          platformPostId: message.platformPostId || '',
          ownerAccount: message.ownerAccount || '',
          caption: message.caption || '',
          pageTitle: message.pageTitle || '',
          clientRequestId: queued.clientRequestId || queued.id,
          capturedVia: message.capturedVia || 'extension_publish_guardian',
        });
        await markQueueItemDone(queued.id, result);
        const { flags } = await persistLastProtectSuccess(result, {
          platform: message.platform,
          pageUrl: message.pageUrl || '',
          postUrl: message.postUrl || '',
          fileName: message.fileName || '',
        });
        console.info('[PinIT] Protect success', {
          assetId: result.assetId || null,
          vaultId: result.vaultId,
          certificateId: result.certificateId,
          monitorId: result.monitorId,
          platform: message.platform || 'web',
          pageUrl: message.pageUrl || null,
          postUrl: message.postUrl || null,
          degraded: flags.degraded,
        });
        return { ok: true, result, clientRequestId: queued.id, degraded: flags.degraded };
      } catch (err) {
        const error = String(err.message || err);
        const stack = err && err.stack ? String(err.stack) : '';
        await setBadge('Q', '#f59e0b');
        console.error('[PinIT] [sw] [PUBLISH_CAPTURE.protect_failed_queued]', {
          id: queued.id,
          platform: message.platform || 'web',
          fileName: message.fileName || null,
          pageUrl: message.pageUrl || null,
          error,
          stack,
        });
        await persistLastProtectPending({
          platform: message.platform,
          pageUrl: message.pageUrl || '',
          postUrl: message.postUrl || '',
          fileName: message.fileName || '',
          queueId: queued.id,
          stage: 'protect.failed_queued',
          error,
          message: `Protect failed — queued for retry: ${error}`,
        });
        try {
          const q = await getQueue();
          const item = q.find((i) => i.id === queued.id);
          if (item) {
            item.lastError = error;
            item.lastErrorStack = stack;
            await saveQueue(q);
            await chrome.storage.local.set({
              lastQueueFailure: {
                at: Date.now(),
                id: item.id,
                platform: item.platform,
                fileName: item.fileName,
                pageUrl: item.pageUrl,
                attempts: item.attempts,
                status: item.status,
                error,
                stack,
              },
            });
          }
        } catch {
          /* ignore persistence errors */
        }
        return {
          ok: true,
          queued: true,
          clientRequestId: queued.id,
          error,
          message: 'Protect failed — queued for retry',
        };
      }
    }
    case 'REGISTER_POST': {
      const result = await registerPost(message.payload || {});
      // Keep lastProtect.postUrl in sync for adapter observers
      try {
        const { lastProtect } = await chrome.storage.local.get(['lastProtect']);
        const postUrl = message.payload?.postUrl;
        if (lastProtect && postUrl) {
          const same =
            lastProtect.vaultId === message.payload.vaultId ||
            lastProtect.protectedPostId === message.payload.protectedPostId;
          if (same) {
            await chrome.storage.local.set({
              lastProtect: { ...lastProtect, postUrl, publicUrlBound: true },
            });
          }
        }
      } catch {
        /* ignore */
      }
      console.info('[PinIT] Platform URL registered', {
        platform: message.payload?.platform,
        postUrl: message.payload?.postUrl,
      });
      return { ok: true, result };
    }
    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

async function flushQueue() {
  const summary = await processQueue(async (file, meta) => publishProtect(file, meta));
  // Critical: async queue successes must write lastProtect so REGISTER_POST can bind.
  for (const r of summary.results || []) {
    if (r.ok && r.result?.vaultId) {
      await persistLastProtectSuccess(r.result, {
        platform: r.platform,
        pageUrl: r.pageUrl || '',
        postUrl: r.postUrl || '',
        fileName: r.fileName || '',
      });
      console.info('[PinIT] [sw] [queue_flush.protect_bound]', {
        id: r.id,
        assetId: r.result.assetId || null,
        vaultId: r.result.vaultId,
        protectedPostId: r.result.protectedPostId || null,
      });
    }
  }
  if (summary.pending > 0) await setBadge(String(Math.min(9, summary.pending)), '#f59e0b');
  else if (summary.failed > 0) await setBadge('!', '#ef4444');
  await recordHealth('queue_flush');
  return summary;
}

async function syncFromHub() {
  const { accessToken } = await getConfig();
  if (!accessToken) return { skipped: true };
  try {
    const data = await apiJson('/extension/sync');
    await chrome.storage.local.set({
      syncSnapshot: {
        at: Date.now(),
        syncedAt: data.syncedAt,
        postCount: data.posts?.length ?? 0,
        stats: data.stats ?? null,
      },
    });
    return { synced: true, postCount: data.posts?.length ?? 0 };
  } catch (err) {
    return { synced: false, error: String(err.message || err) };
  }
}

async function fetchAsFile(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch media (${res.status})`);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

function dataUrlToFile(dataUrl, name) {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'application/octet-stream';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text: text || '' });
  if (color) await chrome.action.setBadgeBackgroundColor({ color });
}
