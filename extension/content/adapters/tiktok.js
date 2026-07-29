/** TikTok Web upload — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_TT_ADAPTER__) return;
  window.__PINIT_TT_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before tiktok.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('tiktok', {
    supportsRealtime: false,
    acceptAll: true,
  });
  console.info('[PinIT] tiktok Publish Guardian adapter active');
})();
