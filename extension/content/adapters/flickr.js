/** flickr — PlatformAdapter (photographer / design pack). */
(function () {
  if (window.__PINIT_FL_ADAPTER__) return;
  window.__PINIT_FL_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before flickr.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('flickr', { supportsRealtime: false, acceptAll: true });
  console.info('[PinIT] flickr Publish Guardian adapter active');
})();
