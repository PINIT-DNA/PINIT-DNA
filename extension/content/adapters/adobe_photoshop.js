/** adobe_photoshop — PlatformAdapter (photographer / design pack). */
(function () {
  if (window.__PINIT_PH_ADAPTER__) return;
  window.__PINIT_PH_ADAPTER__ = true;
  window.__PINIT_EXPORT_PLATFORM__ = 'adobe_photoshop';
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before adobe_photoshop.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('adobe_photoshop', {
    supportsRealtime: false,
    acceptAll: true,
    platformType: 'business',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([/photoshop\.adobe/i]) ||
        PinITAdapter.hasComposerDialog(['upload', 'open', 'export', 'download'])
      );
    },
  });
  console.info('[PinIT] adobe_photoshop Publish Guardian adapter active');
})();
