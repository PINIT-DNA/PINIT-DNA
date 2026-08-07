/** Telegram Web — Creator Mode only when attaching media to send (not chat browsing alone). */
(function () {
  if (window.__PINIT_TG_ADAPTER__) return;
  window.__PINIT_TG_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before telegram.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('telegram', {
    supportsRealtime: false,
    platformType: 'social',
    detectPublishContext() {
      // Attachment picker / send media — not reading chat history
      return (
        PinITAdapter.hasComposerDialog(['send', 'attach', 'upload', 'photo', 'video', 'file']) ||
        !!document.querySelector('input[type="file"]')
      );
    },
  });
  console.info('[PinIT] Telegram adapter active (creator-gated)');
})();
