/** smugmug — PlatformAdapter (photographer / design pack). */
(function () {
  if (window.__PINIT_SM_ADAPTER__) return;
  window.__PINIT_SM_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before smugmug.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('smugmug', { supportsRealtime: false, acceptAll: true });
  console.info('[PinIT] smugmug Publish Guardian adapter active');
})();
