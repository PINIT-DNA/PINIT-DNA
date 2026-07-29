/** Reddit image/video submit — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_RD_ADAPTER__) return;
  window.__PINIT_RD_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before reddit.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('reddit', {
    supportsRealtime: false,
    acceptAll: false,
  });
  console.info('[PinIT] reddit Publish Guardian adapter active');
})();
