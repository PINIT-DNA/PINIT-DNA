/** Facebook Web — Publish Guardian adapter (PlatformAdapter contract). */
(function () {
  if (window.__PINIT_FB_ADAPTER__) return;
  window.__PINIT_FB_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before facebook.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('facebook', { supportsRealtime: false });
  console.info('[PinIT] Facebook adapter active');
})();
