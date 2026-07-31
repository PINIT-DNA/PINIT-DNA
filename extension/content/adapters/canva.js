/** Canva — upload adapter + export protect. */
(function () {
  if (window.__PINIT_CV_ADAPTER__) return;
  window.__PINIT_CV_ADAPTER__ = true;
  window.__PINIT_EXPORT_PLATFORM__ = 'canva';
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before canva.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('canva', { supportsRealtime: false, acceptAll: true });
  console.info('[PinIT] canva Publish Guardian adapter active');
})();
