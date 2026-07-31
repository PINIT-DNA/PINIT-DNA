/** Pinterest Web — Publish Guardian adapter (PlatformAdapter contract). */
(function () {
  if (window.__PINIT_PIN_ADAPTER__) return;
  window.__PINIT_PIN_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before pinterest.js');
    return;
  }
  // Pinterest uploads are typically images; still accept video if present
  PinITAdapter.createFileInputAdapter('pinterest', { supportsRealtime: false });
  console.info('[PinIT] Pinterest adapter active');
})();
