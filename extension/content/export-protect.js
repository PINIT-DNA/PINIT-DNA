/**
 * Protect-on-export — detect download/export gestures without blocking them.
 * Shows a non-blocking confirm; if accepted, captures bytes in parallel.
 */
(function () {
  if (window.__PINIT_EXPORT_GUARD__) return;
  window.__PINIT_EXPORT_GUARD__ = true;

  const PLATFORM = window.__PINIT_EXPORT_PLATFORM__ || 'web';
  const prompted = new WeakSet();

  function looksLikeExport(el) {
    if (!(el instanceof Element)) return false;
    const text = `${el.textContent || ''} ${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('download') || ''}`.toLowerCase();
    const href = (el.getAttribute?.('href') || '').toLowerCase();
    return (
      /export|download|save as|share link|publish/.test(text) ||
      el.hasAttribute('download') ||
      /\.(png|jpe?g|webp|gif|mp4|pdf|svg)(\?|$)/.test(href)
    );
  }

  async function offerProtect(fileOrUrl, meta = {}) {
    const ok = window.confirm('Protect this export with PinIT?\n\nVault + DNA + Certificate + Monitoring will run in parallel. Your export will not be blocked.');
    if (!ok) return;

    if (fileOrUrl instanceof Blob) {
      const reader = new FileReader();
      const dataUrl = await new Promise((res, rej) => {
        reader.onload = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(fileOrUrl);
      });
      chrome.runtime.sendMessage({
        type: 'PLATFORM_EVENT',
        event: {
          platform: PLATFORM,
          action: 'export',
          confidence: 100,
          dataUrl,
          fileName: meta.fileName || `export-${Date.now()}.bin`,
          pageTitle: document.title,
          pageUrl: location.href,
          platformSurface: `${PLATFORM}-export`,
          captureMethod: 'export-gesture',
          capturedVia: 'extension_export_protect',
        },
      });
      return;
    }

    if (typeof fileOrUrl === 'string') {
      chrome.runtime.sendMessage({
        type: 'PLATFORM_EVENT',
        event: {
          platform: PLATFORM,
          action: 'export',
          confidence: 100,
          mediaUrl: fileOrUrl,
          fileName: meta.fileName || `export-${Date.now()}.bin`,
          pageTitle: document.title,
          pageUrl: location.href,
          postUrl: location.href,
          platformSurface: `${PLATFORM}-export`,
          captureMethod: 'export-gesture',
          capturedVia: 'extension_export_protect',
        },
      });
    }
  }

  document.addEventListener(
    'click',
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const el = t.closest('a,button,[role="button"],[download]');
      if (!el || !looksLikeExport(el)) return;
      if (prompted.has(el)) return;
      prompted.add(el);

      const href = el.getAttribute('href');
      const download = el.getAttribute('download');
      // Never preventDefault — export continues; protect is optional parallel offer
      setTimeout(() => {
        if (href && /^https?:/i.test(href)) {
          void offerProtect(href, { fileName: download || undefined });
        } else if (href && href.startsWith('blob:')) {
          void offerProtect(href, { fileName: download || undefined });
        } else {
          // No direct URL — still offer protect of last canvas/image if present
          const img = document.querySelector('img[src^="blob:"], img[src^="data:"]');
          if (img?.src) void offerProtect(img.src);
        }
      }, 50);
    },
    true,
  );

  // Also catch programmatic downloads via <a download> creation
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n instanceof HTMLAnchorElement && n.hasAttribute('download') && n.href) {
          setTimeout(() => void offerProtect(n.href, { fileName: n.download || undefined }), 30);
        }
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  console.info(`[PinIT] Export protect active (${PLATFORM})`);
})();
