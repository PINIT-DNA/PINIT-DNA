/**
 * YouTube Studio adapter — Sprint 4 production hardenting.
 * Spec: docs/PLATFORM_ADAPTER_SPECIFICATIONS/02_YOUTUBE_STUDIO.md
 *
 * Captures original File on picker / drag-drop WITHOUT blocking YouTube upload.
 * Late-binds watch URL (youtube.com/watch?v=...) via DOM / history / MutationObserver.
 */
(function () {
  if (window.__PINIT_YT_ADAPTER__) return;
  window.__PINIT_YT_ADAPTER__ = true;

  const PLATFORM = 'youtube';

  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before youtube.js');
    return;
  }

  /** Assigned after createFileInputAdapter — MAIN-world hook may fire early. */
  let adapter = null;
  const pendingMainFiles = [];
  const seenMainFiles = new WeakSet();

  function log(stage, details) {
    if (details === undefined) {
      console.info(`[PinIT] [${PLATFORM}] ${stage}`);
    } else {
      console.info(`[PinIT] [${PLATFORM}] ${stage}`, details);
    }
    if (typeof PinITAdapter?.recordStage === 'function') {
      PinITAdapter.recordStage(PLATFORM, stage, details);
    }
  }

  async function ingestMainFiles(files, via) {
    for (const file of files) {
      if (!file || seenMainFiles.has(file)) continue;
      if (!adapter || typeof adapter.captureFiles !== 'function') {
        pendingMainFiles.push({ file, via });
        continue;
      }
      seenMainFiles.add(file);
      log('capture.file_input_change', {
        via: via || 'main_world',
        fileCount: 1,
        name: file.name,
        size: file.size,
        mime: file.type,
        pageUrl: location.href,
      });
      await adapter.captureFiles([file], via || 'extension_youtube_main_hook');
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'pinit-yt-main') return;

    log(data.stage || 'main.message', data.detail || {
      via: data.via,
      href: data.href,
      fileCount: data.files ? data.files.length : undefined,
      inputMeta: data.inputMeta || undefined,
    });

    if (data.stage === 'main.file_selected' && Array.isArray(data.files) && data.files.length) {
      void ingestMainFiles(data.files, data.via || 'main_file_selected');
    }
  });

  function isStudioSurface() {
    try {
      const host = location.hostname.replace(/^www\./, '');
      if (host === 'studio.youtube.com') return true;
      // youtube.com upload entry points
      if (host.endsWith('youtube.com') && /\/upload|\/create/i.test(location.pathname)) return true;
      return host.endsWith('youtube.com');
    } catch {
      return false;
    }
  }

  function extractChannelHint() {
    const fromPath = location.pathname.match(/\/channel\/([^/]+)/);
    if (fromPath) return fromPath[1];
    const fromAt = location.pathname.match(/\/@([^/]+)/);
    if (fromAt) return '@' + fromAt[1];
    const el =
      document.querySelector('#channel-title, ytcp-channel-name, #avatar-btn img[alt]') ||
      document.querySelector('a[href*="/channel/"], a[href*="/@"]');
    if (el) {
      const href = el.getAttribute('href') || '';
      const m = href.match(/\/(channel\/[^/]+|@[^/]+)/);
      if (m) return m[1];
      const alt = el.getAttribute('alt');
      if (alt) return alt;
      const text = (el.textContent || '').trim();
      if (text) return text.slice(0, 80);
    }
    return null;
  }

  function extractProfileUrl() {
    const channel = extractChannelHint();
    if (!channel) return null;
    if (channel.startsWith('channel/') || channel.startsWith('@')) {
      return `https://www.youtube.com/${channel}`;
    }
    if (channel.startsWith('@')) return `https://www.youtube.com/${channel}`;
    return `https://www.youtube.com/@${channel.replace(/^@/, '')}`;
  }

  function findWatchUrlInDom() {
    const anchors = Array.from(document.querySelectorAll('a[href*="watch?v="], a[href*="youtu.be/"]'));
    for (const a of anchors) {
      try {
        const u = new URL(a.href, location.origin);
        const id = u.searchParams.get('v');
        if (id && /^[\w-]{6,}$/.test(id)) {
          return `https://www.youtube.com/watch?v=${id}`;
        }
        if (u.hostname.includes('youtu.be')) {
          const shortId = u.pathname.replace(/^\//, '');
          if (shortId && /^[\w-]{6,}$/.test(shortId)) {
            return `https://www.youtube.com/watch?v=${shortId}`;
          }
        }
      } catch {
        /* ignore */
      }
    }
    // Sometimes Studio shows video id in the URL after create
    try {
      const m = location.href.match(/[?&]video_id=([\w-]{6,})/);
      if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
      const pathId = location.pathname.match(/\/video\/([\w-]{6,})/);
      if (pathId) return `https://www.youtube.com/watch?v=${pathId[1]}`;
    } catch {
      /* ignore */
    }
    return null;
  }

  let lastBoundUrl = null;
  let bindInFlight = false;

  function tryBindPublicUrl(source) {
    const href = findWatchUrlInDom();
    if (!href || href === lastBoundUrl) return;
    if (bindInFlight) return;
    if (typeof PinITAdapter?.isExtensionAlive === 'function' && !PinITAdapter.isExtensionAlive()) {
      console.info('[PinIT] [youtube] [adapter.context_stale]', {
        source,
        hint: 'Refresh this tab after reloading the extension',
      });
      return;
    }
    bindInFlight = true;

    try {
      chrome.storage.local.get(['lastProtect', 'lastCaptureAttempt', 'lastQueueFailure'], (data) => {
        bindInFlight = false;
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message || '';
          if (/extension context invalidated/i.test(msg)) {
            console.info('[PinIT] [youtube] [adapter.context_stale]', { source: 'storage', message: msg });
            return;
          }
          console.warn('[PinIT] [youtube] storage read failed', msg);
          return;
        }
        const last = data.lastProtect;
        const attempt = data.lastCaptureAttempt;
        const fail = data.lastQueueFailure;
        if (!last?.vaultId && !last?.protectedPostId) {
          log('Public URL seen but no recent protect to bind', {
            href,
            source,
            lastProtectPending: !!(last && last.pending),
            lastProtectError: !!(last && last.error),
            lastProtectMessage: last && last.message ? last.message : null,
            lastProtectAt: last && last.at ? last.at : null,
            lastCaptureAttempt: attempt
              ? {
                  stage: attempt.stage,
                  fileName: attempt.fileName,
                  at: attempt.at,
                  error: attempt.error || null,
                  queueId: attempt.queueId || null,
                }
              : null,
            lastQueueFailure: fail
              ? { id: fail.id, error: fail.error, at: fail.at }
              : null,
            hint: !attempt
              ? 'No capture reached the service worker — check Capture stages (file_input_change → PUBLISH_CAPTURE.received)'
              : last && last.pending
                ? 'Capture queued; waiting for publish-protect success before URL bind'
                : fail
                  ? 'Protect failed — see lastQueueFailure; URL bind skipped until vaultId exists'
                  : 'lastProtect missing vaultId/protectedPostId',
          });
          return;
        }
        if (last.platform && last.platform !== PLATFORM) {
          log('Public URL skipped — platform mismatch', {
            href,
            lastPlatform: last.platform,
            expected: PLATFORM,
          });
          return;
        }
        if (Date.now() - (last.at || 0) > 6 * 60 * 60 * 1000) {
          log('Public URL skipped — lastProtect too old', {
            href,
            ageMs: Date.now() - (last.at || 0),
          });
          return;
        }
        if (last.postUrl && String(last.postUrl).includes('watch?v=')) {
          lastBoundUrl = last.postUrl;
          return;
        }

        lastBoundUrl = href;
        log('Public URL detected', {
          href,
          source,
          vaultId: last.vaultId,
          protectedPostId: last.protectedPostId,
          assetId: last.assetId || null,
        });
        try {
          chrome.runtime.sendMessage(
            {
              type: 'REGISTER_POST',
              payload: {
                vaultId: last.vaultId,
                protectedPostId: last.protectedPostId,
                platform: PLATFORM,
                postUrl: href,
                ownerAccount: extractChannelHint(),
                profileUrl: extractProfileUrl(),
              },
            },
            (res) => {
              if (chrome.runtime.lastError) {
                const msg = chrome.runtime.lastError.message || '';
                if (/extension context invalidated/i.test(msg)) {
                  console.info('[PinIT] [youtube] [adapter.context_stale]', { source: 'bind', message: msg });
                } else {
                  console.warn('[PinIT] [youtube] URL bind failed', msg);
                }
                lastBoundUrl = null;
                return;
              }
              if (res?.ok) log('Monitoring context updated', { href, vaultId: last.vaultId });
              else {
                console.error('[PinIT] [youtube] [REGISTER_POST.failed]', {
                  href,
                  error: res?.error || res,
                });
                lastBoundUrl = null;
              }
            },
          );
        } catch (e) {
          bindInFlight = false;
          lastBoundUrl = null;
          if (/extension context invalidated/i.test(String(e && e.message))) {
            console.info('[PinIT] [youtube] [adapter.context_stale]', { source: 'bind_throw' });
          } else {
            console.warn('[PinIT] [youtube] URL bind throw', e);
          }
        }
      });
    } catch (e) {
      bindInFlight = false;
      if (/extension context invalidated/i.test(String(e && e.message))) {
        console.info('[PinIT] [youtube] [adapter.context_stale]', { source: 'storage_throw' });
      }
    }
  }

  adapter = PinITAdapter.createFileInputAdapter(PLATFORM, {
    supportsRealtime: false,
    acceptAll: true,
    detectPublishContext() {
      return isStudioSurface();
    },
    ownerAccount() {
      return extractChannelHint();
    },
    profileUrl() {
      return extractProfileUrl();
    },
    getPostUrl() {
      return findWatchUrlInDom();
    },
    onAfterCapture(res) {
      if (res?.ok) {
        log(res.queued ? 'capture.queued' : 'capture.vault_success', {
          assetId: res.result?.assetId || null,
          vaultId: res.result?.vaultId || null,
          certificateId: res.result?.certificateId || null,
          monitorId: res.result?.monitorId || null,
          degraded: !!res.degraded,
          clientRequestId: res.clientRequestId || null,
          pageUrl: location.href,
        });
        if (res.result?.assetId) log('Asset created', res.result.assetId);
        if (res.result?.certificateId) log('Certificate issued', res.result.certificateId);
        if (res.result?.monitorId) log('Monitoring enrolled', res.result.monitorId);
        if (res.degraded) log('Degraded protect state', res.result);
        tryBindPublicUrl('after_capture');
      } else if (!res?.skipped) {
        console.error('[PinIT] [youtube] [capture.protect_failed]', {
          error: res?.error || res,
          message: res?.message,
        });
      }
    },
  });

  // Flush any MAIN-world files that arrived before adapter was ready
  if (pendingMainFiles.length) {
    const queued = pendingMainFiles.splice(0, pendingMainFiles.length);
    void (async () => {
      for (const item of queued) {
        await ingestMainFiles([item.file], item.via);
      }
    })();
  }

  let dialogScanTimer = null;
  function detectUploadDialog(reason) {
    const run = () => {
      dialogScanTimer = null;
      const dialogs = document.querySelectorAll(
        'ytcp-uploads-dialog, ytcp-upload-dialog, ytcp-upload-file-picker, ytcp-uploads-file-picker, tp-yt-paper-dialog, #dialog',
      );
      const inputs = PinITAdapter.findAllFileInputs
        ? PinITAdapter.findAllFileInputs(document)
        : Array.from(document.querySelectorAll('input[type="file"]'));
      const iframeCount = document.querySelectorAll('iframe').length;
      log('upload_dialog.scan', {
        reason,
        dialogCount: dialogs.length,
        fileInputCount: inputs.length,
        shadowInputs: inputs.filter(
          (i) => i.getRootNode && i.getRootNode() instanceof ShadowRoot,
        ).length,
        iframeCount,
        accepts: inputs.slice(0, 5).map((i) => i.accept || '*/*'),
        pageUrl: location.href,
      });
      // Also surface as probe fields for popup telemetry
      log('main.dom_probe', {
        reason: 'isolated_' + reason,
        fileInputCount: inputs.length,
        dialogHostCount: dialogs.length,
        iframeCount,
        newlyHooked: 0,
        pageUrl: location.href,
      });
      if (typeof adapter.scanFileInputs === 'function') {
        adapter.scanFileInputs();
      }
    };
    if (reason === 'mutation') {
      if (dialogScanTimer) return;
      dialogScanTimer = setTimeout(run, 300);
      return;
    }
    run();
  }

  if (!isStudioSurface()) {
    log('Adapter active on YouTube host (upload surfaces preferred)', { pageUrl: location.href });
  } else {
    log('Upload page detected', { pageUrl: location.href, channel: extractChannelHint() });
  }

  detectUploadDialog('init');
  setTimeout(() => detectUploadDialog('t+1s'), 1000);
  setTimeout(() => detectUploadDialog('t+3s'), 3000);

  const obs = new MutationObserver(() => {
    detectUploadDialog('mutation');
    tryBindPublicUrl('mutation');
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  const wrapHistory = (method) => {
    const original = history[method];
    if (typeof original !== 'function') return;
    history[method] = function (...args) {
      const ret = original.apply(this, args);
      setTimeout(() => tryBindPublicUrl('history_' + method), 0);
      return ret;
    };
  };
  wrapHistory('pushState');
  wrapHistory('replaceState');
  window.addEventListener('popstate', () => tryBindPublicUrl('popstate'));
  window.addEventListener('yt-navigate-finish', () => tryBindPublicUrl('yt_navigate'), true);

  // Periodic soft poll — Studio often injects watch links late after processing
  let polls = 0;
  const pollId = setInterval(() => {
    polls += 1;
    tryBindPublicUrl('poll');
    if (polls >= 120) clearInterval(pollId); // ~10 min at 5s
  }, 5000);

  log('youtube Publish Guardian adapter active', {
    pageUrl: location.href,
    version: chrome.runtime.getManifest?.()?.version,
  });

  // Keep reference so GC doesn't drop adapter listeners unexpectedly
  window.__PINIT_YT_ADAPTER_REF__ = adapter;
})();
