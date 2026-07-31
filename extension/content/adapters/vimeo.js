/** Vimeo video upload — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_VM_ADAPTER__) return;
  window.__PINIT_VM_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before vimeo.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('vimeo', {
    supportsRealtime: false,
    acceptAll: true,
  });
  console.info('[PinIT] vimeo Publish Guardian adapter active');
})();
