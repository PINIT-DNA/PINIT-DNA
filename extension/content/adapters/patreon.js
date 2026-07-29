/** Patreon public post media — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_PT_ADAPTER__) return;
  window.__PINIT_PT_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before patreon.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('patreon', {
    supportsRealtime: false,
    acceptAll: false,
  });
  console.info('[PinIT] patreon Publish Guardian adapter active');
})();
