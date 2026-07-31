/** Figma — upload adapter + export protect. */
(function () {
  if (window.__PINIT_FG_ADAPTER__) return;
  window.__PINIT_FG_ADAPTER__ = true;
  window.__PINIT_EXPORT_PLATFORM__ = 'figma';
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before figma.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('figma', { supportsRealtime: false, acceptAll: true });
  console.info('[PinIT] figma Publish Guardian adapter active');
})();
