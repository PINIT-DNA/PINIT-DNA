/** Telegram Web — public channels only (PlatformAdapter). Private chats remain out of scope. */
(function () {
  if (window.__PINIT_TG_ADAPTER__) return;
  window.__PINIT_TG_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before telegram.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('telegram', { supportsRealtime: false });
  console.info('[PinIT] Telegram Web adapter active (public content only)');
})();
