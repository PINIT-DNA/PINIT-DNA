/** wix — PlatformAdapter (photographer / design pack). */
(function () {
  if (window.__PINIT_WX_ADAPTER__) return;
  window.__PINIT_WX_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before wix.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('wix', { supportsRealtime: false, acceptAll: true });
  console.info('[PinIT] wix Publish Guardian adapter active');
})();
