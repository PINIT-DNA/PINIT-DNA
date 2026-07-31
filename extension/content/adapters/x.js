/** X / Twitter Web — Publish Guardian adapter (PlatformAdapter contract). */
(function () {
  if (window.__PINIT_X_ADAPTER__) return;
  window.__PINIT_X_ADAPTER__ = true;
  if (!globalThis.PinITAdapter?.createFileInputAdapter) {
    console.error('[PinIT] adapter-interface.js must load before x.js');
    return;
  }
  PinITAdapter.createFileInputAdapter('x', {
    supportsRealtime: false,
    profileUrl() {
      const handle = location.pathname.split('/').filter(Boolean)[0];
      return handle ? `${location.origin}/${handle}` : null;
    },
    ownerAccount() {
      return location.pathname.split('/').filter(Boolean)[0] || null;
    },
  });
  console.info('[PinIT] X adapter active');
})();
