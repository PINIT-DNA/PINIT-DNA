/** X / Twitter Web — Creator Mode only (compose). Timeline browsing = Viewer Mode. */
(function () {
  if (window.__PINIT_X_ADAPTER__) return;
  window.__PINIT_X_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before x.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('x', {
    supportsRealtime: false,
    platformType: 'social',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([/\/compose\//i, /\/messages\/compose/i]) ||
        PinITAdapter.hasComposerDialog(['compose', 'post', 'media', 'what.?s happening', 'add photos'])
      );
    },
    profileUrl() {
      const handle = location.pathname.split('/').filter(Boolean)[0];
      return handle ? `${location.origin}/${handle}` : null;
    },
    ownerAccount() {
      return location.pathname.split('/').filter(Boolean)[0] || null;
    },
  });
  console.info('[PinIT] X adapter active (creator-gated)');
})();
