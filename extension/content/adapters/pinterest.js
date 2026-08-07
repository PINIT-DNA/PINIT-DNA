/** Pinterest Web — Creator Mode only (pin builder). Feed browsing = Viewer Mode. */
(function () {
  if (window.__PINIT_PIN_ADAPTER__) return;
  window.__PINIT_PIN_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before pinterest.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('pinterest', {
    supportsRealtime: false,
    platformType: 'social',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([/\/pin-builder/i, /\/pin-creation/i, /\/create/i]) ||
        PinITAdapter.hasComposerDialog(['create pin', 'upload', 'drag and drop', 'choose a file'])
      );
    },
  });
  console.info('[PinIT] Pinterest adapter active (creator-gated)');
})();
