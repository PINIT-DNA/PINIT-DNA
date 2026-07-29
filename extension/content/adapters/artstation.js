/** ArtStation artwork upload — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_AS_ADAPTER__) return;
  window.__PINIT_AS_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before artstation.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('artstation', {
    supportsRealtime: false,
    acceptAll: false,
  });
  console.info('[PinIT] artstation Publish Guardian adapter active');
})();
