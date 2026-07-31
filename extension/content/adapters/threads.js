/** Threads compose upload — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_TH_ADAPTER__) return;
  window.__PINIT_TH_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before threads.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('threads', {
    supportsRealtime: false,
    acceptAll: false,
  });
  console.info('[PinIT] threads Publish Guardian adapter active');
})();
