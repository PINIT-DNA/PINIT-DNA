/** adobe_express — PlatformAdapter (photographer / design pack). */
(function () {
  if (window.__PINIT_AE_ADAPTER__) return;
  window.__PINIT_AE_ADAPTER__ = true;
  window.__PINIT_EXPORT_PLATFORM__ = 'adobe_express';
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before adobe_express.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('adobe_express', {
    supportsRealtime: false,
    acceptAll: true,
    platformType: 'business',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([/express\.adobe/i, /\/new/i, /\/id\//i]) ||
        PinITAdapter.hasComposerDialog(['upload', 'import', 'download', 'export'])
      );
    },
  });
  console.info('[PinIT] adobe_express Publish Guardian adapter active');
})();
