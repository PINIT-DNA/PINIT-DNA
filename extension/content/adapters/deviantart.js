/** DeviantArt deviation upload — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_DA_ADAPTER__) return;
  window.__PINIT_DA_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before deviantart.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('deviantart', {
    supportsRealtime: false,
    acceptAll: false,
  });
  console.info('[PinIT] deviantart Publish Guardian adapter active');
})();
