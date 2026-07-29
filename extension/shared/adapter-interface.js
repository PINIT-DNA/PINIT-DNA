/**
 * Platform adapter contract — classic content-script build (no ES modules).
 * Loaded before each site adapter via manifest.
 *
 * Contract:
 *   detectPublishContext()
 *   captureMedia(file) → dataUrl
 *   extractMetadata()
 *   getPostUrl()
 *   supportsRealtime
 */
(function (global) {
  function toDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
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
   * }} [options]
   */
  function createFileInputAdapter(platformId, options) {
    options = options || {};
    const seen = new WeakSet();

    const adapter = {
      id: platformId,
      supportsRealtime: !!options.supportsRealtime,
      detectPublishContext() {
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
    };

    document.addEventListener(
      'change',
      async (e) => {
        const input = e.target;
        if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
        if (!adapter.detectPublishContext()) return;

        for (const file of Array.from(input.files || [])) {
          if (seen.has(file)) continue;
          const okType =
            file.type.startsWith('image/') ||
            file.type.startsWith('video/') ||
            options.acceptAll;
          if (!okType) continue;
          seen.add(file);
          try {
            const dataUrl = await adapter.captureMedia(file);
            const meta = adapter.extractMetadata();
            chrome.runtime.sendMessage(
              {
                type: 'PUBLISH_CAPTURE',
                platform: platformId,
                dataUrl,
                fileName: file.name || `${platformId}-${Date.now()}.bin`,
                postUrl: adapter.getPostUrl(),
                caption: '',
                ...meta,
              },
              (res) => {
                if (chrome.runtime.lastError) return;
                if (typeof options.onAfterCapture === 'function') {
                  options.onAfterCapture(res || {});
                } else if (res?.ok) {
                  console.info(`[PinIT] ${platformId} media protected`, res.result?.protectedPostId);
                } else if (!res?.skipped) {
                  console.warn(`[PinIT] Protect failed`, res?.error);
                }
              },
            );
          } catch (err) {
            console.warn(`[PinIT] ${platformId} capture error`, err);
          }
        }
      },
      true,
    );

    return adapter;
  }

  global.PinITAdapter = {
    createFileInputAdapter,
    /** @type {null} documented shape only */
    PlatformAdapter: null,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
