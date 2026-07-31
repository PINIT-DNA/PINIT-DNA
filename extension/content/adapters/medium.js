/** Medium article images — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_MD_ADAPTER__) return;
  window.__PINIT_MD_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before medium.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('medium', {
    supportsRealtime: false,
    acceptAll: false,
  });
  console.info('[PinIT] medium Publish Guardian adapter active');
})();
