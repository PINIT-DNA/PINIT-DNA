/** zenfolio — PlatformAdapter (photographer / design pack). */
(function () {
  if (window.__PINIT_ZF_ADAPTER__) return;
  window.__PINIT_ZF_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before zenfolio.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('zenfolio', { supportsRealtime: false, acceptAll: true });
  console.info('[PinIT] zenfolio Publish Guardian adapter active');
})();
