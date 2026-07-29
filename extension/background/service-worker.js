/**
 * PinIT Publish Guardian — background service worker (MV3).
 * Includes offline queue, retry/backoff, and cross-browser sync.
 */

import { getConfig, clearTokens } from '../shared/config.js';
import { publishProtect, registerPost, verifyIdentity, exchangeAuthCode, apiJson } from '../shared/api.js';
import { enqueueProtect, processQueue, getQueue } from '../shared/queue.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'pinit-verify',
      title: 'Verify with PinIT',
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: 'pinit-protect',
      title: 'Protect with PinIT',
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: 'pinit-investigate',
      title: 'Open PinIT Investigation',
      contexts: ['image', 'page'],
    });
  });
  chrome.alarms.create('pinit-queue-flush', { periodInMinutes: 1 });
  chrome.alarms.create('pinit-sync', { periodInMinutes: 15 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pinit-queue-flush') {
    void flushQueue();
  }
  if (alarm.name === 'pinit-sync') {
    void syncFromHub();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'pinit-investigate') {
    const { config } = await getConfig();
    const hub = config.hubBaseUrl.replace(/\/$/, '');
    chrome.tabs.create({ url: `${hub}/pinit-hub/investigation` });
    return;
  }

  if (info.menuItemId === 'pinit-protect' && info.srcUrl) {
    const platform = detectPlatformFromUrl(info.pageUrl || tab?.url || '') || 'web';
    return handleMessage({
      type: 'PUBLISH_CAPTURE',
      platform,
      mediaUrl: info.srcUrl,
      postUrl: info.pageUrl || tab?.url || '',
      pageTitle: tab?.title || '',
      fileName: `protect-${Date.now()}.bin`,
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

async function handleMessage(message) {
  switch (message?.type) {
    case 'GET_STATUS': {
      const state = await getConfig();
      const last = await chrome.storage.local.get(['lastProtect', 'lastVerify', 'syncSnapshot']);
      const queue = await getQueue();
      return {
        ok: true,
        signedIn: !!state.accessToken,
        user: state.user,
        config: state.config,
        lastProtect: last.lastProtect || null,
        lastVerify: last.lastVerify || null,
        syncSnapshot: last.syncSnapshot || null,
        queue: {
          pending: queue.filter((i) => i.status === 'pending' || i.status === 'processing').length,
          failed: queue.filter((i) => i.status === 'failed').length,
          done: queue.filter((i) => i.status === 'done').length,
        },
      };
    }
    case 'SIGN_OUT':
      await clearTokens();
      await setBadge('', '#6366f1');
      return { ok: true };
    case 'EXCHANGE_AUTH_CODE': {
      const data = await exchangeAuthCode(message.code);
      await syncFromHub();
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
    case 'PUBLISH_CAPTURE': {
      const { config, accessToken } = await getConfig();
      if (!config.publishGuardianEnabled) {
        return { ok: false, error: 'Publish Guardian disabled in options' };
      }
      // Default-on for new platforms not yet stored in older option configs
      const platformEnabled =
        message.platform === 'web' ||
        config.platforms?.[message.platform] !== false;
      if (!platformEnabled) {
        return { ok: false, skipped: true, error: `Platform ${message.platform} disabled` };
      }
      if (!message.dataUrl && !message.mediaUrl) {
        throw new Error('No media captured');
      }

      // Always enqueue for reliability; try immediate send when online + signed in
      const queued = await enqueueProtect(message);
      if (!accessToken || !navigator.onLine) {
        await setBadge('Q', '#f59e0b');
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
          mediaUrl: message.mediaUrl || '',
          profileUrl: message.profileUrl || '',
          platformPostId: message.platformPostId || '',
          ownerAccount: message.ownerAccount || '',
          caption: message.caption || '',
          pageTitle: message.pageTitle || '',
          clientRequestId: queued.clientRequestId || queued.id,
          capturedVia: message.capturedVia || 'extension_publish_guardian',
        });
        // Mark queue item done via flush (idempotent)
        await flushQueue();
        await chrome.storage.local.set({
          lastProtect: { at: Date.now(), ...result, platform: message.platform },
        });
        await setBadge('✓', '#10b981');
        return { ok: true, result, clientRequestId: queued.id };
      } catch (err) {
        await setBadge('Q', '#f59e0b');
        return {
          ok: true,
          queued: true,
          clientRequestId: queued.id,
          error: String(err.message || err),
          message: 'Protect failed — queued for retry',
        };
      }
    }
    case 'REGISTER_POST': {
      const result = await registerPost(message.payload || {});
      return { ok: true, result };
    }
    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

async function flushQueue() {
  const summary = await processQueue(async (file, meta) => publishProtect(file, meta));
  if (summary.pending > 0) await setBadge(String(Math.min(9, summary.pending)), '#f59e0b');
  else if (summary.failed > 0) await setBadge('!', '#ef4444');
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

// Flush on startup
void flushQueue();
