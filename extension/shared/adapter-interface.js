/**
 * Platform adapter contract — classic content-script build (no ES modules).
 *
 * Critical: YouTube Studio / many SPAs put <input type="file"> inside Shadow DOM.
 * The `change` event is NOT composed, so document-level listeners never see it.
 * We therefore deep-scan (including open shadow roots) and attach listeners
 * directly to each file input, and re-scan on DOM mutations.
 *
 * After extension reload, orphaned content scripts hit "Extension context invalidated".
 * Those must soft-stop (no console.error) so Edge/Chrome Errors UI stays clean —
 * user should refresh the tab after Reload.
 */
(function (global) {
  function toDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('FileReader failed'));
      r.readAsDataURL(file);
    });
  }

  function isInvalidatedError(error) {
    const msg = String((error && error.message) || error || '');
    return /extension context invalidated/i.test(msg);
  }

  /** False when extension was reloaded and this content script is orphaned. */
  function isExtensionAlive() {
    try {
      return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function errLog(platformId, stage, error, details) {
    const message = error && (error.message || String(error));
    if (isInvalidatedError(error) || /extension context invalidated/i.test(String(message))) {
      // Soft — do NOT use console.error (Edge surfaces those as extension Errors)
      console.info(`[PinIT] [${platformId}] [adapter.context_stale]`, {
        stage,
        hint: 'Reload finished — refresh this tab to reattach PinIT',
        ...(details || {}),
      });
      return;
    }
    const stack = error && error.stack ? String(error.stack) : undefined;
    console.error(`[PinIT] [${platformId}] [${stage}]`, {
      ...(details || {}),
      error: message,
      stack,
    });
  }

  /** Persist stage breadcrumbs for popup / debugging (survives tab focus loss). */
  function recordStage(platformId, stage, details) {
    try {
      if (!isExtensionAlive()) return;
      chrome.storage.local.get(['captureTelemetry'], (data) => {
        if (chrome.runtime.lastError) return;
        const prev = data.captureTelemetry || { stages: [] };
        const stages = Array.isArray(prev.stages) ? prev.stages.slice(-40) : [];
        stages.push({
          at: Date.now(),
          platform: platformId,
          stage,
          details: details
            ? {
                name: details.name,
                size: details.size,
                mime: details.mime,
                fileCount: details.fileCount,
                found: details.found,
                newlyHooked: details.newlyHooked,
                pipelineId: details.pipelineId,
                via: details.via,
                reason: details.reason,
                fileInputCount: details.fileInputCount,
                dialogHostCount: details.dialogHostCount,
                iframeCount: details.iframeCount,
                inShadow: details.inShadow,
                pageUrl: details.pageUrl || details.href,
              }
            : null,
        });
        chrome.storage.local.set({
          captureTelemetry: {
            at: Date.now(),
            platform: platformId,
            pageUrl: (details && (details.pageUrl || details.href)) || prev.pageUrl || null,
            lastStage: stage,
            stages,
            probe: details && details.fileInputCount != null
              ? {
                  fileInputCount: details.fileInputCount,
                  dialogHostCount: details.dialogHostCount,
                  iframeCount: details.iframeCount,
                  newlyHooked: details.newlyHooked,
                  reason: details.reason,
                }
              : prev.probe || null,
          },
        });
      });
    } catch {
      /* ignore */
    }
  }

  function log(platformId, stage, details) {
    const prefix = `[PinIT] [${platformId}] [${stage}]`;
    if (details === undefined) {
      console.info(prefix);
    } else {
      console.info(prefix, details);
    }
    const track =
      /^(adapter\.|capture\.|main\.|upload_dialog)/.test(stage) ||
      stage === 'PUBLISH_CAPTURE.received';
    if (track) recordStage(platformId, stage, details);
  }

  /**
   * Deep-collect file inputs, piercing open shadow roots.
   * @param {ParentNode} root
   * @param {HTMLInputElement[]} out
   * @param {number} depth
   */
  function collectFileInputsDeep(root, out, depth) {
    if (!root || depth > 40) return;
    let nodes = [];
    try {
      if (root.querySelectorAll) {
        nodes = Array.from(root.querySelectorAll('input[type="file"]'));
      }
    } catch {
      /* ignore cross-origin / closed shadow */
    }
    for (const n of nodes) {
      if (n instanceof HTMLInputElement) out.push(n);
    }

    let all = [];
    try {
      if (root.querySelectorAll) all = Array.from(root.querySelectorAll('*'));
    } catch {
      return;
    }
    for (const el of all) {
      if (el.shadowRoot) collectFileInputsDeep(el.shadowRoot, out, depth + 1);
    }
  }

  function findAllFileInputs(doc) {
    const out = [];
    collectFileInputsDeep(doc, out, 0);
    return out;
  }

  /**
   * @param {string} platformId
   * @param {{
   *   supportsRealtime?: boolean,
   *   acceptAll?: boolean,
   *   profileUrl?: () => string|null,
   *   ownerAccount?: () => string|null,
   *   getPostUrl?: () => string|null,
   *   onAfterCapture?: (result: object) => void,
   *   detectPublishContext?: () => boolean,
   * }} [options]
   */
  function createFileInputAdapter(platformId, options) {
    options = options || {};
    const seenFiles = new WeakSet();
    const hookedInputs = new WeakSet();
    let stopped = false;
    let mutationScanTimer = null;
    let intervalId = null;
    let mo = null;
    const delayTimers = [];

    function teardown(reason) {
      if (stopped) return;
      stopped = true;
      try {
        if (mutationScanTimer) clearTimeout(mutationScanTimer);
        mutationScanTimer = null;
        if (intervalId) clearInterval(intervalId);
        intervalId = null;
        delayTimers.forEach((t) => clearTimeout(t));
        delayTimers.length = 0;
        if (mo) mo.disconnect();
        mo = null;
      } catch {
        /* ignore */
      }
      console.info(`[PinIT] [${platformId}] [adapter.teardown]`, {
        reason,
        hint: 'Refresh this tab after reloading the extension',
      });
    }

    function ensureAlive() {
      if (stopped) return false;
      if (isExtensionAlive()) return true;
      teardown('extension_context_invalidated');
      return false;
    }

    const adapter = {
      id: platformId,
      supportsRealtime: !!options.supportsRealtime,
      detectPublishContext() {
        if (!ensureAlive()) return false;
        if (typeof options.detectPublishContext === 'function') {
          return options.detectPublishContext();
        }
        return typeof document !== 'undefined';
      },
      async captureMedia(file) {
        return toDataUrl(file);
      },
      extractMetadata() {
        return {
          pageTitle: document.title,
          pageUrl: location.href,
          profileUrl: options.profileUrl ? options.profileUrl() : null,
          ownerAccount: options.ownerAccount ? options.ownerAccount() : null,
        };
      },
      getPostUrl() {
        return options.getPostUrl ? options.getPostUrl() : null;
      },
      scanFileInputs() {
        return scanAndHook('manual_scan');
      },
      /**
       * Capture File objects from MAIN-world hooks / external probes.
       * @param {File[]} files
       * @param {string} capturedVia
       */
      async captureFiles(files, capturedVia) {
        const list = Array.from(files || []);
        for (const file of list) {
          await queueCapture(file, {
            capturedVia: capturedVia || 'extension_publish_guardian_external',
          });
        }
      },
      dispose() {
        teardown('dispose');
      },
    };

    async function queueCapture(file, extra) {
      if (!ensureAlive()) return;
      if (!file || seenFiles.has(file)) {
        log(platformId, 'capture.skip_duplicate', { name: file && file.name });
        return;
      }
      const okType =
        file.type.startsWith('image/') ||
        file.type.startsWith('video/') ||
        options.acceptAll;
      if (!okType) {
        log(platformId, 'capture.skip_unsupported', {
          name: file.name,
          type: file.type || 'unknown',
        });
        return;
      }

      seenFiles.add(file);
      const pageUrl = location.href;
      const pipelineId = `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      log(platformId, 'capture.file_object', {
        pipelineId,
        name: file.name || `${platformId}-${Date.now()}.bin`,
        size: file.size || 0,
        mime: file.type || 'application/octet-stream',
        captureMethod: extra.capturedVia,
        pageUrl,
      });

      try {
        log(platformId, 'capture.read_start', { pipelineId, size: file.size || 0 });
        const dataUrl = await adapter.captureMedia(file);
        if (!ensureAlive()) return;
        const meta = adapter.extractMetadata();
        log(platformId, 'capture.file_bytes_ready', {
          pipelineId,
          name: file.name,
          bytes: file.size || 0,
          dataUrlChars: typeof dataUrl === 'string' ? dataUrl.length : 0,
        });

        const payload = {
          type: 'PUBLISH_CAPTURE',
          platform: platformId,
          dataUrl,
          fileName: file.name || `${platformId}-${Date.now()}.bin`,
          postUrl: adapter.getPostUrl(),
          caption: '',
          pageUrl,
          pipelineId,
          ...meta,
          ...extra,
        };

        log(platformId, 'capture.sendMessage_call', {
          pipelineId,
          platform: platformId,
          fileName: payload.fileName,
          pageUrl,
          dataUrlChars: payload.dataUrl ? payload.dataUrl.length : 0,
        });

        try {
          chrome.runtime.sendMessage(payload, (res) => {
            let lastErr = null;
            try {
              lastErr = chrome.runtime.lastError;
            } catch (e) {
              errLog(platformId, 'capture.sendMessage_lastError', e, { pipelineId });
              teardown('extension_context_invalidated');
              return;
            }
            if (lastErr) {
              if (isInvalidatedError(lastErr)) {
                errLog(platformId, 'capture.sendMessage_lastError', lastErr, { pipelineId });
                teardown('extension_context_invalidated');
                return;
              }
              errLog(platformId, 'capture.sendMessage_lastError', lastErr, {
                pipelineId,
                message: lastErr.message,
              });
              return;
            }
            log(platformId, 'capture.sendMessage_callback', {
              pipelineId,
              ok: !!(res && res.ok),
              queued: !!(res && res.queued),
              skipped: !!(res && res.skipped),
              clientRequestId: res && res.clientRequestId,
              error: res && res.error,
              assetId: res && res.result && res.result.assetId,
              vaultId: res && res.result && res.result.vaultId,
              degraded: !!(res && res.degraded),
            });

            if (typeof options.onAfterCapture === 'function') {
              options.onAfterCapture(res || {});
              return;
            }
            if (res?.ok) {
              log(platformId, res.queued ? 'capture.queued' : 'capture.vault_success', {
                pipelineId,
                assetId: res.result?.assetId || null,
                vaultId: res.result?.vaultId || null,
                certificateId: res.result?.certificateId || null,
                monitorId: res.result?.monitorId || null,
              });
            } else if (!res?.skipped) {
              errLog(platformId, 'capture.protect_failed', new Error(res?.error || 'unknown'), {
                pipelineId,
                res,
              });
            }
          });
        } catch (sendErr) {
          errLog(platformId, 'capture.sendMessage_throw', sendErr, { pipelineId });
          if (isInvalidatedError(sendErr)) teardown('extension_context_invalidated');
        }
      } catch (error) {
        errLog(platformId, 'capture.read_or_send_error', error, { pipelineId });
        if (isInvalidatedError(error)) teardown('extension_context_invalidated');
      }
    }

    function onInputChange(e) {
      if (!ensureAlive()) return;
      const input = e.currentTarget || e.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
      if (!adapter.detectPublishContext()) {
        log(platformId, 'capture.ignored_context', { pageUrl: location.href });
        return;
      }
      log(platformId, 'capture.file_input_change', {
        multiple: !!input.multiple,
        accept: input.accept || '*/*',
        fileCount: (input.files && input.files.length) || 0,
        inShadow: !!(input.getRootNode && input.getRootNode() instanceof ShadowRoot),
        pageUrl: location.href,
      });
      const files = Array.from(input.files || []);
      (async () => {
        for (const file of files) {
          await queueCapture(file, {
            capturedVia: 'extension_publish_guardian_input',
          });
        }
      })();
    }

    function hookInput(input, reason) {
      if (!ensureAlive()) return false;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file') return false;
      if (hookedInputs.has(input)) return false;
      hookedInputs.add(input);
      input.addEventListener('change', onInputChange, true);
      log(platformId, 'adapter.file_input_hooked', {
        reason,
        accept: input.accept || '*/*',
        multiple: !!input.multiple,
        inShadow: !!(input.getRootNode && input.getRootNode() instanceof ShadowRoot),
        pageUrl: location.href,
      });
      return true;
    }

    function scanAndHook(reason) {
      if (!ensureAlive()) return 0;
      if (!adapter.detectPublishContext()) return 0;
      const inputs = findAllFileInputs(document);
      let hooked = 0;
      for (const input of inputs) {
        if (hookInput(input, reason)) hooked += 1;
      }
      log(platformId, 'adapter.file_input_scan', {
        reason,
        found: inputs.length,
        newlyHooked: hooked,
        pageUrl: location.href,
      });
      return hooked;
    }

    // Light document capture (works for light-DOM platforms)
    document.addEventListener(
      'change',
      async (e) => {
        if (!ensureAlive()) return;
        const input = e.target;
        if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
        // Prefer direct hooks; still handle light-DOM change as backup
        if (hookedInputs.has(input)) return;
        hookInput(input, 'document_change_backup');
        if (!adapter.detectPublishContext()) return;
        log(platformId, 'capture.file_input_change', {
          via: 'document_bubble_backup',
          fileCount: (input.files && input.files.length) || 0,
          pageUrl: location.href,
        });
        for (const file of Array.from(input.files || [])) {
          await queueCapture(file, {
            capturedVia: 'extension_publish_guardian_input',
          });
        }
      },
      true,
    );

    document.addEventListener(
      'drop',
      async (e) => {
        if (!ensureAlive()) return;
        if (!adapter.detectPublishContext()) return;
        const files = Array.from(e.dataTransfer?.files || []);
        if (!files.length) return;
        log(platformId, 'capture.drop_detected', {
          count: files.length,
          pageUrl: location.href,
        });
        for (const file of files) {
          await queueCapture(file, {
            capturedVia: 'extension_publish_guardian_drop',
          });
        }
      },
      true,
    );

    // Dynamic / Shadow DOM: keep hooking new file inputs (throttled — Studio mutates heavily)
    mo = new MutationObserver(() => {
      if (!ensureAlive()) return;
      if (mutationScanTimer) return;
      mutationScanTimer = setTimeout(() => {
        mutationScanTimer = null;
        scanAndHook('mutation');
      }, 250);
    });
    try {
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }

    // Initial + delayed scans (Studio mounts upload dialog late)
    log(platformId, 'adapter.upload_page_detected', { pageUrl: location.href });
    scanAndHook('init');
    delayTimers.push(setTimeout(() => scanAndHook('t+500ms'), 500));
    delayTimers.push(setTimeout(() => scanAndHook('t+2000ms'), 2000));
    delayTimers.push(setTimeout(() => scanAndHook('t+5000ms'), 5000));
    intervalId = setInterval(() => scanAndHook('interval_15s'), 15000);

    return adapter;
  }

  global.PinITAdapter = {
    createFileInputAdapter,
    findAllFileInputs,
    collectFileInputsDeep,
    isExtensionAlive,
    recordStage,
    PlatformAdapter: null,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
