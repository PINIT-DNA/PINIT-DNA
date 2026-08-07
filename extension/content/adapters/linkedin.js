/** LinkedIn Web — Creator Mode only (compose / media upload). Feed browsing = Viewer Mode. */
(function () {
  if (window.__PINIT_LI_ADAPTER__) return;
  window.__PINIT_LI_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before linkedin.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('linkedin', {
    supportsRealtime: false,
    platformType: 'business',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([
          /\/(post|sharing|overlay\/create-post|in\/.*\/detail\/recent-activity)/i,
          /\/media-upload/i,
        ]) ||
        PinITAdapter.hasComposerDialog([
          'create a post',
          'start a post',
          'add media',
          'share an article',
          'photo',
          'video',
        ])
      );
    },
  });
  console.info('[PinIT] LinkedIn adapter active (creator-gated)');
})();
