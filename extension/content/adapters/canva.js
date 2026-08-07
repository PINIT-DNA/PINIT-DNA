/** Canva — Creator Mode on design editor uploads; export uses explicit confirm. */
(function () {
  if (window.__PINIT_CV_ADAPTER__) return;
  window.__PINIT_CV_ADAPTER__ = true;
  window.__PINIT_EXPORT_PLATFORM__ = 'canva';
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before canva.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('canva', {
    supportsRealtime: false,
    acceptAll: true,
    platformType: 'business',
    detectPublishContext() {
      // Design editor / folder uploads — not template browsing home
      return (
        PinITAdapter.pathMatches([/\/design\//i, /\/folder\//i, /\/uploads/i]) ||
        PinITAdapter.hasComposerDialog(['upload', 'import', 'your uploads'])
      );
    },
  });
  console.info('[PinIT] canva Publish Guardian adapter active (creator-gated)');
})();
