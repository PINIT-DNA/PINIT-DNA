/** WordPress media library upload — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_WP_ADAPTER__) return;
  window.__PINIT_WP_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before wordpress.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('wordpress', {
    supportsRealtime: false,
    acceptAll: false,
  });
  console.info('[PinIT] wordpress Publish Guardian adapter active');
})();
