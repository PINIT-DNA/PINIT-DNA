/** Twitch asset / clip related uploads — PlatformAdapter contract. */
(function () {
  if (window.__PINIT_TW_ADAPTER__) return;
  window.__PINIT_TW_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before twitch.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('twitch', {
    supportsRealtime: false,
    acceptAll: true,
    platformType: 'creator',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([/dashboard\./i, /\/dashboard/i, /\/u\//i]) ||
        PinITAdapter.hasComposerDialog(['upload', 'edit stream', 'add media'])
      );
    },
  });
  console.info('[PinIT] twitch Publish Guardian adapter active (creator-gated)');
})();
