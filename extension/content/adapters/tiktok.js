/** TikTok Web — Creator Mode only (upload studio). Feed browsing = Viewer Mode. */
(function () {
  if (window.__PINIT_TT_ADAPTER__) return;
  window.__PINIT_TT_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before tiktok.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('tiktok', {
    supportsRealtime: false,
    platformType: 'social',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([/\/upload/i, /\/creator/i, /\/tiktokstudio/i]) ||
        PinITAdapter.hasComposerDialog(['upload', 'select video', 'post', 'choose file'])
      );
    },
  });
  console.info('[PinIT] TikTok adapter active (creator-gated)');
})();
