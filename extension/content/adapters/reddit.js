/** Reddit — Creator Mode only (submit). Feed browsing = Viewer Mode. */
(function () {
  if (window.__PINIT_RD_ADAPTER__) return;
  window.__PINIT_RD_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before reddit.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('reddit', {
    supportsRealtime: false,
    platformType: 'creator',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([/\/submit(\/|$)/i]) ||
        PinITAdapter.hasComposerDialog(['create post', 'upload', 'images & video', 'drag and drop'])
      );
    },
  });
  console.info('[PinIT] Reddit adapter active (creator-gated)');
})();
