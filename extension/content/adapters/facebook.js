/** Facebook Web — Creator Mode only (composer / create). Timeline browsing = Viewer Mode. */
(function () {
  if (window.__PINIT_FB_ADAPTER__) return;
  window.__PINIT_FB_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before facebook.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('facebook', {
    supportsRealtime: false,
    platformType: 'social',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([
          /\/(composer|stories\/create|reels\/create|marketplace\/create)/i,
          /\/photo\/?\?/,
        ]) ||
        PinITAdapter.hasComposerDialog([
          'create post',
          'create reel',
          'create story',
          'photo/video',
          'add photos',
          'add videos',
        ])
      );
    },
  });
  console.info('[PinIT] Facebook adapter active (creator-gated)');
})();
