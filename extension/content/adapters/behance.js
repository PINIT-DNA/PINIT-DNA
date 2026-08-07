/** Behance project media — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_BE_ADAPTER__) return;
  window.__PINIT_BE_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before behance.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('behance', {
    supportsRealtime: false,
    acceptAll: false,
    platformType: 'creator',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([/\/gallery\/create/i, /\/project\/create/i, /\/editor/i]) ||
        PinITAdapter.hasComposerDialog(['upload', 'add media', 'create project'])
      );
    },
  });
  console.info('[PinIT] behance Publish Guardian adapter active (creator-gated)');
})();
