/** GitHub — protect uploaded images/assets via Publish Guardian (PlatformAdapter). */
(function () {
  if (window.__PINIT_GH_ADAPTER__) return;
  window.__PINIT_GH_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before github.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('github', {
    supportsRealtime: false,
    acceptAll: true,
  });
  console.info('[PinIT] GitHub adapter active');
})();
