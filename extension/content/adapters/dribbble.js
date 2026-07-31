/** Dribbble shot upload — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_DR_ADAPTER__) return;
  window.__PINIT_DR_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before dribbble.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('dribbble', {
    supportsRealtime: false,
    acceptAll: false,
  });
  console.info('[PinIT] dribbble Publish Guardian adapter active');
})();
