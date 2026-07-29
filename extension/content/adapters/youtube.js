/** YouTube Studio / upload — file capture (video DNA matching improves later) — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_YT_ADAPTER__) return;
  window.__PINIT_YT_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before youtube.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('youtube', {
    supportsRealtime: false,
    acceptAll: true,
  });
  console.info('[PinIT] youtube Publish Guardian adapter active');
})();
