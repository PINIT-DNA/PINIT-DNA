/** Tumblr post media — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_TB_ADAPTER__) return;
  window.__PINIT_TB_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before tumblr.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('tumblr', {
    supportsRealtime: false,
    acceptAll: false,
  });
  console.info('[PinIT] tumblr Publish Guardian adapter active');
})();
