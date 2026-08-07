/** Substack post media — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_SS_ADAPTER__) return;
  window.__PINIT_SS_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before substack.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('substack', {
    supportsRealtime: false,
    acceptAll: false,
    platformType: 'creator',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([/\/publish/i, /\/post/i]) ||
        PinITAdapter.hasComposerDialog(['write', 'upload', 'add image', 'publish'])
      );
    },
  });
  console.info('[PinIT] substack Publish Guardian adapter active (creator-gated)');
})();
