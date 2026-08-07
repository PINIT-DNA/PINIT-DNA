/** adobe_illustrator — PlatformAdapter (photographer / design pack). */
(function () {
  if (window.__PINIT_AI_ADAPTER__) return;
  window.__PINIT_AI_ADAPTER__ = true;
  window.__PINIT_EXPORT_PLATFORM__ = 'adobe_illustrator';
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before adobe_illustrator.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('adobe_illustrator', {
    supportsRealtime: false,
    acceptAll: true,
    platformType: 'business',
    detectPublishContext() {
      return (
        PinITAdapter.pathMatches([/illustrator\.adobe/i]) ||
        PinITAdapter.hasComposerDialog(['upload', 'open', 'export', 'download'])
      );
    },
  });
  console.info('[PinIT] adobe_illustrator Publish Guardian adapter active');
})();
