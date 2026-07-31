/** pixieset — PlatformAdapter (photographer / design pack). */
(function () {
  if (window.__PINIT_PS_ADAPTER__) return;
  window.__PINIT_PS_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before pixieset.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('pixieset', { supportsRealtime: false, acceptAll: true });
  console.info('[PinIT] pixieset Publish Guardian adapter active');
})();
