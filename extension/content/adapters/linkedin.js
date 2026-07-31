/** LinkedIn Web — Publish Guardian adapter (PlatformAdapter contract). */
(function () {
  if (window.__PINIT_LI_ADAPTER__) return;
  window.__PINIT_LI_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before linkedin.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('linkedin', { supportsRealtime: false });
  console.info('[PinIT] LinkedIn adapter active');
})();
