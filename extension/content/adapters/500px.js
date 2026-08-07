/** 500px — PlatformAdapter (photographer / design pack). */
(function () {
  if (window.__PINIT_PX_ADAPTER__) return;
  window.__PINIT_PX_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before 500px.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('500px', {
    supportsRealtime: false,
    acceptAll: true,
    platformType: 'photo',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([/\/upload/i, /\/photo\/upload/i]) ||
        PinITAdapter.hasComposerDialog(['upload', 'submit photo', 'choose files'])
      );
    },
  });
  console.info('[PinIT] 500px Publish Guardian adapter active');
})();
