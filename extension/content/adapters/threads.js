/** Threads — Creator Mode only (compose). Feed browsing = Viewer Mode. */
(function () {
  if (window.__PINIT_TH_ADAPTER__) return;
  window.__PINIT_TH_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before threads.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('threads', {
    supportsRealtime: false,
    platformType: 'creator',
    detectPublishContext() {
      return PinITAdapter.hasComposerDialog([
        'new thread',
        'create',
        'attach',
        "what's new",
        'add to thread',
      ]);
    },
  });
  console.info('[PinIT] Threads adapter active (creator-gated)');
})();
