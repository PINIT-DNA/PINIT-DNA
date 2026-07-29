/** squarespace — PlatformAdapter (photographer / design pack). */
(function () {
  if (window.__PINIT_SQ_ADAPTER__) return;
  window.__PINIT_SQ_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before squarespace.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('squarespace', { supportsRealtime: false, acceptAll: true });
  console.info('[PinIT] squarespace Publish Guardian adapter active');
})();
